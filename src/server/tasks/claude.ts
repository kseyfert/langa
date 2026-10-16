import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { TaskError } from './types';

export const MODEL_GENERATE = process.env.CLAUDE_MODEL_GENERATE || 'claude-sonnet-5-5';
export const MODEL_GRADE = process.env.CLAUDE_MODEL_GRADE || 'claude-sonnet-5-5';

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
    throw new TaskError('Claude ответил в неожиданном формате. Попробуй ещё раз.');
}

/**
 * Один запрос к Claude, ответ — JSON. Ошибки API переводятся в понятные TaskError.
 * system — неизменная часть промпта: она кэшируется и в следующих запросах стоит дешевле.
 */
export async function askJson(prompt: string, model: string, system?: string): Promise<unknown> {
    let res;
    try {
        // Внутри try: без ключа падает уже конструктор.
        client ??= new Anthropic();
        res = await client.beta.messages.create({
            model,
            max_tokens: 16000,
            // Если классификатор откажет, запрос сам перезапустится на рекомендованной модели.
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
            ...(system && { system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }] }),
            messages: [{ role: 'user', content: prompt }],
        });
    } catch (e) {
        throw new TaskError(errorText(e));
    }
    if (res.stop_reason === 'refusal') throw new TaskError('Claude отказался отвечать на этот запрос.');
    if (res.stop_reason === 'max_tokens') throw new TaskError('Claude ответил в неожиданном формате. Попробуй ещё раз.');
    const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
    return parseJsonLoose(text);
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
