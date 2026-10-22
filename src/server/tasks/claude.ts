import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { propagateAttributes, startObservation } from '@langfuse/tracing';
import { context, trace } from '@opentelemetry/api';
import type { ExerciseType } from '../exercises/types';
import { TaskError } from './types';

export const MODEL_GENERATE = process.env.CLAUDE_MODEL_GENERATE || 'claude-sonnet-5-5';
export const MODEL_GRADE = process.env.CLAUDE_MODEL_GRADE || 'claude-sonnet-5-5';

const BAD_FORMAT = 'Claude ответил в неожиданном формате. Попробуй ещё раз.';
const MAX_TOKENS = 16000;

let client: Anthropic | null = null;

/** Объекты и массивы верхнего уровня в тексте — по балансу скобок, без учёта скобок внутри строк. */
function topLevelJson(text: string): string[] {
    const found: string[] = [];
    let depth = 0, start = -1, inStr = false, esc = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inStr) {
            if (esc) esc = false;
            else if (c === '\\') esc = true;
            else if (c === '"') inStr = false;
        } else if (c === '"' && depth > 0) inStr = true;
        else if (c === '{' || c === '[') { if (depth++ === 0) start = i; }
        else if ((c === '}' || c === ']') && depth > 0 && --depth === 0) found.push(text.slice(start, i + 1));
    }
    return found;
}

/**
 * Ответ модели целиком, иначе тело code fence, иначе последний разбираемый объект в тексте.
 * Последний — потому что модель иногда пишет JSON, замечает ошибку («Wait — …») и присылает
 * исправленный: верен второй.
 */
export function parseJsonLoose(text: string): unknown {
    const tries = [
        text.trim(),
        text.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1]?.trim(),
        ...topLevelJson(text).reverse(),
    ];
    for (const t of tries) {
        if (!t) continue;
        try { return JSON.parse(t); } catch { /* следующий способ */ }
    }
    throw new TaskError(BAD_FORMAT);
}

/** Что за вызов — в метаданные трейса Langfuse. */
export type CallInfo = {
    /** judge — судья evals, не приложение. */
    call: 'generate' | 'grade' | 'judge';
    type: ExerciseType;
    promptVersion: string;
    unitId: number;
    workspaceId: number;
};

/**
 * Один запрос к Claude, ответ — JSON. Ошибки API переводятся в понятные TaskError.
 * system — неизменная часть промпта: она кэшируется и в следующих запросах стоит дешевле.
 * Каждый вызов — трейс Langfuse с генерацией внутри; без ключей Langfuse это no-op.
 */
export function askJson(prompt: string, model: string, system: string | undefined, info: CallInfo): Promise<unknown> {
    const metadata = { call: info.call, type: info.type, prompt_version: info.promptVersion, unit_id: info.unitId, workspace_id: info.workspaceId };
    const run = () => traced(info.call, prompt, model, system);
    // Внутри наблюдения Langfuse (прогон evals) генерация ложится в его трейс, имя трейса не трогаем.
    if (inLangfuseObservation()) return propagateAttributes({ metadata }, run);
    // Иначе свой трейс на вызов: без этого генерация легла бы под span запроса Next, который в Langfuse не уходит.
    // deleteSpan убирает только родителя — метаданные, проброшенные выше (exercise_id), остаются в контексте.
    return context.with(trace.deleteSpan(context.active()), () => propagateAttributes({ traceName: info.call, metadata }, run));
}

/** Активный span создан SDK Langfuse. instrumentationScope — поле ReadableSpan из OTel SDK, в API его нет. */
function inLangfuseObservation(): boolean {
    const span = trace.getActiveSpan() as { instrumentationScope?: { name?: string } } | undefined;
    return span?.instrumentationScope?.name === 'langfuse-sdk';
}

async function traced(name: CallInfo['call'], prompt: string, model: string, system: string | undefined): Promise<unknown> {
    const gen = startObservation(name, {
        model,
        modelParameters: { max_tokens: MAX_TOKENS },
        input: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: prompt }],
    }, { asType: 'generation' });
    /** message — пользователю, detail — в трейс: «неожиданный формат» бывает по разным причинам. */
    const fail = (message: string, detail = message): never => {
        gen.update({ level: 'ERROR', statusMessage: detail }).end();
        throw new TaskError(message);
    };

    let res;
    try {
        // Внутри try: без ключа падает уже конструктор.
        // Свои OTel-спаны SDK выключены: генерацию пишем сами, иначе в Langfuse она была бы дважды.
        client ??= new Anthropic({ openTelemetry: { traces: false, propagation: false } });
        res = await client.beta.messages.create({
            model,
            max_tokens: MAX_TOKENS,
            // Если классификатор откажет, запрос сам перезапустится на рекомендованной модели.
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
            ...(system && { system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }] }),
            messages: [{ role: 'user', content: prompt }],
        });
    } catch (e) {
        const text = errorText(e);
        const raw = e instanceof Error ? e.message : String(e);
        return fail(text, text.includes(raw) ? text : `${text} (${raw})`);
    }
    const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
    const u = res.usage;
    gen.update({
        // Фактическая модель ответа: после отказа классификатора она может быть не той, что просили.
        model: res.model,
        output: text,
        usageDetails: {
            input: u.input_tokens,
            output: u.output_tokens,
            cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
            cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
        },
        metadata: { stop_reason: res.stop_reason, requested_model: model },
    });
    if (res.stop_reason === 'refusal') return fail('Claude отказался отвечать на этот запрос.', 'stop_reason: refusal');
    if (res.stop_reason === 'max_tokens') return fail(BAD_FORMAT, `stop_reason: max_tokens (${MAX_TOKENS})`);
    let json;
    try {
        json = parseJsonLoose(text);
    } catch {
        return fail(BAD_FORMAT, 'ответ не разбирается как JSON');
    }
    gen.end();
    return json;
}

function errorText(e: unknown): string {
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
        return 'Нет доступа к Claude: проверь ANTHROPIC_API_KEY.';
    }
    if (e instanceof Anthropic.RateLimitError) return 'Слишком много запросов. Подожди немного и попробуй снова.';
    if (e instanceof Anthropic.APIConnectionError || e instanceof Anthropic.InternalServerError) {
        return 'Сбой связи с Claude. Попробуй ещё раз.';
    }
    if (e instanceof Anthropic.APIError) return `Ошибка Claude: ${e.message}`;
    // Ошибка SDK без HTTP-ответа — клиент не собрался, обычно нет ключа.
    if (e instanceof Anthropic.AnthropicError) return 'Claude не настроен: задай ANTHROPIC_API_KEY в .env.local.';
    return `Ошибка: ${e instanceof Error ? e.message : String(e)}`;
}
