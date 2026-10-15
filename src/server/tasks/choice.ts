import 'server-only';
import { unitForPrompt } from '../catalog';
import type { ChoiceContent, ClosedEvaluation } from '../exercises/types';
import { askJson, MODEL_GENERATE } from './claude';
import { randomTopic } from './topics';
import { TaskError, type Task } from './types';
import { variety } from './variety';

const PROMPT_VERSION = 'choice-gen-v4';

// Текст — genPrompt прототипа, шапка та же, что у gap (specs/exercise-spec.md §7).
// Отличие от эталона: пропуск в предложении обязателен — в него подставляется выбранный вариант.
function prompt(unit: string, topic: string, varietyRules: string): string {
    return `You write grammar practice for a Russian-speaking adult learner of English (around B2).

Target unit:
${unit}

Practise only the grammar described for this unit. Do not touch topics listed under "Не входит в юнит": they belong to other units.
Context theme: ${topic}. Use natural, varied, everyday English; avoid textbook clichés. Random seed: ${Math.random().toString(36).slice(2, 8)}.
All *_ru fields are in Russian.

${varietyRules}

Make a multiple-choice exercise of exactly 6 items.
- Each "text" is one natural sentence with exactly one blank written as ___ (three underscores).
- The gap must contain the whole verb form that the unit tests, including auxiliaries (do/does/am/is/are/have/will...), in every option. Never put an auxiliary outside the gap.
- For questions, the options include the subject: "___ a receipt?" → options "Do you need", "Are you needing".
- The correct option must not be guessable from the words around the gap without knowing the unit's rule.
- 2 or 3 options; exactly one is correct in context. Distractors are typical mistakes of Russian speakers on this unit. Vary the position of the correct option.
Reply with only JSON: {"instructions_ru":"...","items":[{"text":"...","options":["...","..."],"correct":0,"explain_ru":"one short sentence why"}]}`;
}

const isStr = (v: unknown): v is string => typeof v === 'string';

type Item = ChoiceContent['items'][number];

/** Пункт задания или null, если он не той формы. */
function item(i: unknown): Item | null {
    const o = (i ?? {}) as { text?: unknown; options?: unknown; correct?: unknown; explain_ru?: unknown };
    const ok = isStr(o.text) && o.text.split('___').length === 2 && Array.isArray(o.options)
        && o.options.length > 1 && o.options.every(isStr) && Number.isInteger(o.correct)
        && (o.correct as number) >= 0 && (o.correct as number) < o.options.length;
    return ok ? { text: o.text as string, options: o.options as string[], correct: o.correct as number, explain_ru: isStr(o.explain_ru) ? o.explain_ru : '' } : null;
}

/** Как у gap: годные пункты, план фокуса прорежен вместе с ними. */
function normalize(d: unknown, plan: string[]): ChoiceContent {
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

export const choice: Task<'choice'> = {
    type: 'choice',

    async generate(unitId) {
        const topic = randomTopic();
        const [unit, v] = await Promise.all([unitForPrompt(unitId), variety(unitId)]);
        const content = normalize(await askJson(prompt(unit, topic, v.prompt), MODEL_GENERATE), v.focus);
        return { content, topic, model: MODEL_GENERATE, promptVersion: PROMPT_VERSION };
    },

    parseAnswer(raw, content) {
        const ok = Array.isArray(raw) && raw.length === content.items.length
            && raw.every((v, i) => v === null || (Number.isInteger(v) && v >= 0 && v < content.items[i].options.length));
        if (!ok) throw new TaskError(`Нужно ответов: ${content.items.length}, по одному на пункт`);
        return raw as (number | null)[];
    },

    async check(_unitId, content, answer) {
        const items = content.items.map((it, index) => ({ index, given: answer[index], correct: answer[index] === it.correct }));
        const evaluation: ClosedEvaluation = { items, correct: items.filter((i) => i.correct).length, total: items.length };
        return { evaluation, model: null, promptVersion: null };
    },
};
