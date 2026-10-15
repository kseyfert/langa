import 'server-only';
import { unitForPrompt } from '../catalog';
import type { ClosedEvaluation, GapContent } from '../exercises/types';
import { askJson, MODEL_GENERATE } from './claude';
import { randomTopic } from './topics';
import { TaskError, type Task } from './types';

const PROMPT_VERSION = 'gap-gen-v1';

// Текст — genPrompt прототипа, с правками из specs/exercise-spec.md §7:
// юнит описан через unitForPrompt (с guide), и задание не выходит за его границы.
function prompt(unit: string, topic: string): string {
    return `You write grammar practice for a Russian-speaking adult learner of English (around B2).

Target unit:
${unit}

Practise only the grammar described for this unit. Do not touch topics listed under "Не входит в юнит": they belong to other units.
Context theme: ${topic}. Use natural, varied, everyday English; avoid textbook clichés. Random seed: ${Math.random().toString(36).slice(2, 8)}.
All *_ru fields are in Russian.

Make a gap-fill exercise of exactly 6 items.
- Each "text" is one natural sentence with exactly one blank written as ___ (three underscores).
- When the answer is a form of a given word, put the base word in brackets right after the blank, e.g. "She ___ (work) here."
- The correct answer must be decided by the grammar of the target unit, not by vocabulary.
- "answers" lists EVERY acceptable filling: contracted and full forms ("hasn't arrived","has not arrived"), and any alternative that is also correct in context.
- Vary affirmative, negative and question forms where the unit allows.
Reply with only JSON: {"instructions_ru":"...","items":[{"text":"...","answers":["..."],"explain_ru":"one short sentence why"}]}`;
}

const isStr = (v: unknown): v is string => typeof v === 'string';

/** Как normalizeEx прототипа: пункты не той формы отбрасываются; ни одного годного — ошибка. */
function normalize(d: unknown): GapContent {
    const o = (d ?? {}) as { instructions_ru?: unknown; items?: unknown };
    const items = (Array.isArray(o.items) ? o.items : [])
        .filter((i): i is { text: string; answers: unknown[]; explain_ru?: unknown } =>
            !!i && isStr(i.text) && i.text.split('___').length === 2 && Array.isArray(i.answers))
        .map((i) => ({ text: i.text, answers: i.answers.filter(isStr).filter((a) => a.trim()), explain_ru: isStr(i.explain_ru) ? i.explain_ru : '' }))
        .filter((i) => i.answers.length > 0);
    if (!items.length) throw new TaskError('Claude ответил в неожиданном формате. Попробуй ещё раз.');
    return { instructions_ru: isStr(o.instructions_ru) ? o.instructions_ru : '', items };
}

/** Нормализация ответа — norm прототипа: регистр, апострофы, пробелы, кавычки и финальная пунктуация. */
export const norm = (s: string) =>
    s.toLowerCase().replace(/[’‘`]/g, "'").replace(/\s+/g, ' ').replace(/^[\s"]+|[\s".,!?]+$/g, '').trim();

export const gap: Task<'gap'> = {
    type: 'gap',

    async generate(unitId) {
        const topic = randomTopic();
        const content = normalize(await askJson(prompt(await unitForPrompt(unitId), topic), MODEL_GENERATE));
        return { content, topic, model: MODEL_GENERATE, promptVersion: PROMPT_VERSION };
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
