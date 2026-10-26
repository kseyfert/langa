import 'server-only';
import type { GapContent } from '../../exercises/types';
import { closedContent, isStr, object, text } from '../define';
import { TaskError, type TaskType } from '../types';

type Item = GapContent['items'][number];

/** Пункт задания или null, если он не той формы. */
function item(i: unknown): Item | null {
    const o = (i ?? {}) as { text?: unknown; answers?: unknown; explain_ru?: unknown };
    if (!isStr(o.text) || o.text.split('___').length !== 2 || !Array.isArray(o.answers)) return null;
    const answers = o.answers.filter(isStr).filter((a) => a.trim());
    return answers.length ? { text: o.text, answers, explain_ru: isStr(o.explain_ru) ? o.explain_ru : '' } : null;
}

/** Нормализация ответа — norm прототипа: регистр, апострофы, пробелы, кавычки и финальная пунктуация. */
export const norm = (s: string) =>
    s.toLowerCase().replace(/[’‘`]/g, "'").replace(/\s+/g, ' ').replace(/^[\s"]+|[\s".,!?]+$/g, '').trim();

export const gap = {
    type: 'gap',
    items: 6,

    /**
     * Описания полей — бывший хвост «Reply with only JSON» generate.md.
     * Число пунктов схема не ограничивает — его держит normalize.
     */
    outputSchema: object({
        instructions_ru: text(),
        items: { type: 'array', items: object({ text: text(), answers: { type: 'array', items: text() }, explain_ru: text('one short sentence why') }) },
    }),

    normalize: (raw, plan) => closedContent(raw, plan, item),

    publicContent: ({ instructions_ru, items }) => ({ instructions_ru, items: items.map(({ text }) => ({ text })) }),

    sentences: (c) => c.items.map((i) => i.text.replace('___', `[${i.answers[0]}]`)),

    parseAnswer(raw, content) {
        if (!Array.isArray(raw) || raw.length !== content.items.length || !raw.every(isStr)) {
            throw new TaskError(`Нужно ответов: ${content.items.length}, по одному на пропуск`);
        }
        return raw;
    },

    check: {
        by: 'key',
        score: (content, answer) => content.items.map((it, i) => it.answers.some((a) => norm(a) === norm(answer[i]))),
    },
} satisfies TaskType<'gap'>;
