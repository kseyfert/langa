import type { Task } from './types';
import { MOCK, mockTopic } from './mock';
import { TaskError } from './types';

// Заглушка: настоящая генерация и проверка — позже.
export const choice: Task<'choice'> = {
    type: 'choice',

    async generate() {
        return {
            ...MOCK,
            topic: mockTopic(),
            content: {
                instructions_ru: 'Выбери верный вариант.',
                items: [{ text: "I ___ Tom tomorrow, it's all arranged.", options: ["'m meeting", 'meet', 'will have met'], correct: 0, explain_ru: 'Заглушка.' }],
            },
        };
    },

    parseAnswer(raw, content) {
        const ok = Array.isArray(raw) && raw.length === content.items.length
            && raw.every((v) => v === null || Number.isInteger(v));
        if (!ok) throw new TaskError(`Нужно ответов: ${content.items.length}, по одному на пункт`);
        return raw as (number | null)[];
    },

    async check(_unitId, content, answer) {
        const items = content.items.map((_, index) => ({ index, given: answer[index], correct: true }));
        return { evaluation: { items, correct: items.length, total: items.length }, model: null, promptVersion: null };
    },
};
