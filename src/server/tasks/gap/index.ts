import 'server-only';
import { getUnit } from '../../catalog';
import type { ClosedEvaluation, GapContent } from '../../exercises/types';
import { askJson, MODEL_GENERATE } from '../claude';
import { prompts, seed, unitValues } from '../prompt';
import { randomTopic } from '../topics';
import { TaskError, type Task } from '../types';
import { plan, recent } from '../variety';

const isStr = (v: unknown): v is string => typeof v === 'string';

type Item = GapContent['items'][number];

/** Пункт задания или null, если он не той формы. */
function item(i: unknown): Item | null {
    const o = (i ?? {}) as { text?: unknown; answers?: unknown; explain_ru?: unknown };
    if (!isStr(o.text) || o.text.split('___').length !== 2 || !Array.isArray(o.answers)) return null;
    const answers = o.answers.filter(isStr).filter((a) => a.trim());
    return answers.length ? { text: o.text, answers, explain_ru: isStr(o.explain_ru) ? o.explain_ru : '' } : null;
}

/**
 * Как normalizeEx прототипа: пункты не той формы отбрасываются; ни одного годного — ошибка.
 * План фокуса прорежается вместе с пунктами, чтобы focus[i] по-прежнему описывал items[i].
 */
function normalize(d: unknown, plan: string[]): GapContent {
    const o = (d ?? {}) as { instructions_ru?: unknown; items?: unknown };
    const all = (Array.isArray(o.items) ? o.items : []).map(item);
    const kept = all.flatMap((it, k) => (it ? [k] : []));
    if (!kept.length) throw new TaskError('Claude ответил в неожиданном формате. Попробуй ещё раз.');
    return {
        instructions_ru: isStr(o.instructions_ru) ? o.instructions_ru : '',
        items: kept.map((k) => all[k]!),
        focus: kept.map((k) => plan[k] ?? ''),
    };
}

/** Нормализация ответа — norm прототипа: регистр, апострофы, пробелы, кавычки и финальная пунктуация. */
export const norm = (s: string) =>
    s.toLowerCase().replace(/[’‘`]/g, "'").replace(/\s+/g, ' ').replace(/^[\s"]+|[\s".,!?]+$/g, '').trim();

export const gap: Task<'gap'> = {
    type: 'gap',

    async generate(unitId) {
        const p = prompts('gap', ['generate', 'focus-repeat']);
        const topic = randomTopic();
        const [unit, used] = await Promise.all([getUnit(unitId), recent(unitId)]);
        const focus = plan(unit.guide, 6, (point) => p.fill('focus-repeat', { point }));
        const prompt = p.fill('generate', {
            ...unitValues(unit), topic, seed: seed(),
            focus: focus.map((f, i) => `${i + 1}. ${f}`).join('\n'),
            recent: used.map((s) => `- ${s}`).join('\n'),
        });
        const content = normalize(await askJson(prompt, MODEL_GENERATE), focus);
        return { content, topic, model: MODEL_GENERATE, promptVersion: p.version };
    },

    parseAnswer(raw, content) {
        if (!Array.isArray(raw) || raw.length !== content.items.length || !raw.every(isStr)) {
            throw new TaskError(`Нужно ответов: ${content.items.length}, по одному на пропуск`);
        }
        return raw;
    },

    async check(_unitId, content, answer) {
        const items = content.items.map((it, index) => ({
            index,
            given: answer[index],
            correct: it.answers.some((a) => norm(a) === norm(answer[index])),
        }));
        const evaluation: ClosedEvaluation = { items, correct: items.filter((i) => i.correct).length, total: items.length };
        return { evaluation, model: null, promptVersion: null };
    },
};
