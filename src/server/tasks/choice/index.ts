import 'server-only';
import type { ChoiceContent } from '../../exercises/types';
import { closedContent, isStr, object, text } from '../define';
import { TaskError, type TaskType } from '../types';

type Item = ChoiceContent['items'][number];

/** Пункт задания или null, если он не той формы. */
function item(i: unknown): Item | null {
    const o = (i ?? {}) as { text?: unknown; options?: unknown; correct?: unknown; explain_ru?: unknown };
    const ok = isStr(o.text) && o.text.split('___').length === 2 && Array.isArray(o.options)
        && o.options.length > 1 && o.options.every(isStr) && Number.isInteger(o.correct)
        && (o.correct as number) >= 0 && (o.correct as number) < o.options.length;
    return ok ? { text: o.text as string, options: o.options as string[], correct: o.correct as number, explain_ru: isStr(o.explain_ru) ? o.explain_ru : '' } : null;
}

export const choice = {
    type: 'choice',
    items: 6,

    /** Как у gap; 2–3 варианта и валидный correct держит normalize. */
    outputSchema: object({
        instructions_ru: text(),
        items: { type: 'array', items: object({ text: text(), options: { type: 'array', items: text() }, correct: { type: 'integer' }, explain_ru: text('one short sentence why') }) },
    }),

    normalize: (raw, plan) => closedContent(raw, plan, item),

    publicContent: ({ instructions_ru, items }) => ({ instructions_ru, items: items.map(({ text, options }) => ({ text, options })) }),

    sentences: (c) => c.items.map((i) => i.text.replace('___', `[${i.options[i.correct]}]`)),

    parseAnswer(raw, content) {
        const ok = Array.isArray(raw) && raw.length === content.items.length
            && raw.every((v, i) => v === null || (Number.isInteger(v) && v >= 0 && v < content.items[i].options.length));
        if (!ok) throw new TaskError(`Нужно ответов: ${content.items.length}, по одному на пункт`);
        return raw as (number | null)[];
    },

    check: {
        by: 'key',
        score: (content, answer) => content.items.map((it, i) => answer[i] === it.correct),
    },
} satisfies TaskType<'choice'>;
