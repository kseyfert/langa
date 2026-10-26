import 'server-only';
import { BAD_FORMAT, isStr, object, parseOpenAnswer, text } from '../define';
import { TaskError, type TaskType } from '../types';

export const rephrase = {
    type: 'rephrase',
    items: 1,

    /** Описания — бывший хвост generate.md. */
    outputSchema: object({
        instructions_ru: text(),
        source_en: text(),
        reference_en: { type: 'array', items: text(), description: 'one model answer' },
    }),

    /** Как normalizeEx прототипа: без исходного предложения задания нет. */
    normalize(raw, plan) {
        const o = (raw ?? {}) as Record<string, unknown>;
        if (!isStr(o.source_en) || !o.source_en.trim()) throw new TaskError(BAD_FORMAT);
        return {
            instructions_ru: isStr(o.instructions_ru) ? o.instructions_ru : '',
            source_en: o.source_en,
            reference_en: Array.isArray(o.reference_en) ? o.reference_en.filter(isStr) : [],
            focus: plan,
        };
    },

    // focus называет грамматику, start_with (старые задания) выдаёт ответ — клиенту ни то ни другое.
    publicContent: ({ reference_en, focus, start_with, ...rest }) => rest,

    sentences: (c) => [`${c.source_en} [${c.reference_en[0] ?? ''}]`],

    parseAnswer: parseOpenAnswer,

    check: {
        by: 'model',
        task: (c) => ({ source: c.source_en, instructions: c.instructions_ru, reference: c.reference_en.join(' | ') }),
    },
} satisfies TaskType<'rephrase'>;
