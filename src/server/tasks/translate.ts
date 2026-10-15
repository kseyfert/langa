import type { Task } from './types';
import { MOCK, mockOpenEvaluation, mockTopic, parseOpenAnswer } from './mock';

// Заглушка: настоящая генерация и проверка через Claude — позже.
export const translate: Task<'translate'> = {
    type: 'translate',

    async generate() {
        return {
            ...MOCK,
            topic: mockTopic(),
            content: { instructions_ru: 'Переведи на английский.', source_ru: 'Завтра я встречаюсь с Томом, мы уже договорились.', target_note_ru: 'Заглушка.', reference_en: ["I'm meeting Tom tomorrow, we've already arranged it."] },
        };
    },

    parseAnswer: parseOpenAnswer,

    async check(_unitId, _content, answer) {
        return { ...MOCK, evaluation: mockOpenEvaluation(answer) };
    },
};
