import type { Task } from './types';
import { MOCK, mockOpenEvaluation, mockTopic, parseOpenAnswer } from './mock';

// Заглушка: настоящая генерация и проверка через Claude — позже.
export const free: Task<'free'> = {
    type: 'free',

    async generate() {
        return {
            ...MOCK,
            topic: mockTopic(),
            content: { instructions_ru: 'Ответь в 2–4 предложениях.', prompt_ru: 'Какие у тебя планы на выходные?', prompt_en: 'What are your plans for the weekend?', reference_en: ["I'm visiting my parents on Saturday."] },
        };
    },

    parseAnswer: parseOpenAnswer,

    async check(_unitId, _content, answer) {
        return { ...MOCK, evaluation: mockOpenEvaluation(answer) };
    },
};
