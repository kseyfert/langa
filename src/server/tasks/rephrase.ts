import type { Task } from './types';
import { MOCK, mockOpenEvaluation, mockTopic, parseOpenAnswer } from './mock';

// Заглушка: настоящая генерация и проверка через Claude — позже.
export const rephrase: Task<'rephrase'> = {
    type: 'rephrase',

    async generate() {
        return {
            ...MOCK,
            topic: mockTopic(),
            content: { instructions_ru: 'Перепиши, сохранив смысл.', source_en: 'Tom and I have an arrangement to meet tomorrow.', start_with: 'I', reference_en: ["I'm meeting Tom tomorrow."] },
        };
    },

    parseAnswer: parseOpenAnswer,

    async check(_unitId, _content, answer) {
        return { ...MOCK, evaluation: mockOpenEvaluation(answer) };
    },
};
