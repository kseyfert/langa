import type { OpenAnswer, OpenEvaluation } from '../exercises/types';
import { randomTopic } from './topics';
import { TaskError } from './types';

// Заглушки для типов, которые ещё не сделаны: без Claude, всегда одно и то же.
// model = 'mock' — такие задания в логе легко найти и удалить.
export const MOCK = { model: 'mock', promptVersion: 'mock' } as const;
export const mockTopic = randomTopic;

export function parseOpenAnswer(raw: unknown): OpenAnswer {
    const text = (raw as { text?: unknown } | null)?.text;
    if (typeof text !== 'string' || !text.trim()) throw new TaskError('Ответ пустой');
    return { text: text.trim() };
}

/** Заглушка проверки открытого ответа: всегда «верно, с целевой конструкцией». */
export function mockOpenEvaluation(answer: OpenAnswer): OpenEvaluation {
    return {
        verdict: 'correct_target',
        summary_ru: 'Заглушка: проверка этого типа ещё не сделана.',
        target: { status: 'correct', score: 100, fragment: '', fix: '', comment_ru: '' },
        others: [],
        issues: [],
        corrected_answer: answer.text,
        natural_version: answer.text,
    };
}
