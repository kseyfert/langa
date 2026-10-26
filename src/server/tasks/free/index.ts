import 'server-only';
import { BAD_FORMAT, isStr, object, parseOpenAnswer, text } from '../define';
import { FREE_LENGTH, TaskError, type TaskType } from '../types';

export const free = {
    type: 'free',
    items: 1,

    /** Описания — бывший хвост generate.md. Длину эталона держит промпт. */
    outputSchema: object({
        instructions_ru: text(),
        prompt_en: text(),
        reference_en: { type: 'array', items: text(), description: 'one model answer' },
    }),

    /** Рамки ответа — в generate.md: эталон должен в них уложиться. */
    generateValues: { min: String(FREE_LENGTH.min), max: String(FREE_LENGTH.max) },

    /** Как normalizeEx прототипа: без вопроса задания нет. */
    normalize(raw, plan) {
        const o = (raw ?? {}) as Record<string, unknown>;
        if (!isStr(o.prompt_en) || !o.prompt_en.trim()) throw new TaskError(BAD_FORMAT);
        return {
            instructions_ru: isStr(o.instructions_ru) ? o.instructions_ru : '',
            prompt_en: o.prompt_en,
            reference_en: Array.isArray(o.reference_en) ? o.reference_en.filter(isStr) : [],
            focus: plan,
        };
    },

    publicContent: ({ reference_en, focus, ...rest }) => rest,

    sentences: (c) => [`${c.prompt_en || c.prompt_ru} [${c.reference_en[0] ?? ''}]`],

    parseAnswer(raw) {
        const answer = parseOpenAnswer(raw);
        const n = answer.text.length;
        if (n < FREE_LENGTH.min || n > FREE_LENGTH.max) throw new TaskError(`Нужно от ${FREE_LENGTH.min} до ${FREE_LENGTH.max} символов, сейчас ${n}`);
        return answer;
    },

    check: {
        by: 'model',
        task: (c) => ({ question: c.prompt_en || c.prompt_ru || '', reference: c.reference_en.join(' | ') }),
    },
} satisfies TaskType<'free'>;
