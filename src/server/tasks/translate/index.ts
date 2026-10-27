import 'server-only';
import { BAD_FORMAT, isStr, object, parseOpenAnswer, text } from '../define';
import { TaskError, type TaskType } from '../types';

export const translate = {
    type: 'translate',
    items: 1,

    /**
     * Описания — бывший хвост generate.md. Модель заполняет поля по порядку схемы: пояснение —
     * после эталона, чтобы сверяться с готовым переводом, а не расходиться с ним.
     */
    outputSchema: object({
        instructions_ru: text(),
        source_ru: text(),
        reference_en: { type: 'array', items: text(), description: 'one model translation' },
        target_note_ru: text(),
    }),

    /** Как normalizeEx прототипа: без исходного текста задания нет. */
    normalize(raw, plan) {
        const o = (raw ?? {}) as Record<string, unknown>;
        if (!isStr(o.source_ru) || !o.source_ru.trim()) throw new TaskError(BAD_FORMAT);
        return {
            instructions_ru: isStr(o.instructions_ru) ? o.instructions_ru : '',
            source_ru: o.source_ru,
            target_note_ru: isStr(o.target_note_ru) ? o.target_note_ru : '',
            reference_en: Array.isArray(o.reference_en) ? o.reference_en.filter(isStr) : [],
            focus: plan,
        };
    },

    publicContent: ({ target_note_ru, reference_en, focus, ...rest }) => rest,

    sentences: (c) => [`${c.source_ru} [${c.reference_en[0] ?? ''}]`],

    parseAnswer: parseOpenAnswer,

    check: {
        by: 'model',
        task: (c) => ({ source: c.source_ru, reference: c.reference_en.join(' | ') }),
    },
} satisfies TaskType<'translate'>;
