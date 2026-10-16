import type { AnswerByType, ContentByType, Evaluation, ExerciseType } from '../exercises/types';

/**
 * Типы, которые уже сделаны по-настоящему; остальные — заглушки и в выдачу не попадают.
 * Здесь, а не в tasks/index.ts: список нужен и клиенту (выбор типа для тестов).
 */
export const READY_TYPES = ['gap', 'choice', 'rephrase', 'translate', 'free'] as const satisfies readonly ExerciseType[];
export type ReadyType = (typeof READY_TYPES)[number];

/** Объём свободного ответа в символах. Здесь, а не в free.ts: рамки показывает и клиент. */
export const FREE_LENGTH = { min: 150, max: 300 } as const;

export type Generated<T extends ExerciseType> = {
    content: ContentByType[T];
    topic: string;
    model: string;
    promptVersion: string;
};

export type Checked = {
    evaluation: Evaluation;
    model: string | null;          // null — проверено локально
    promptVersion: string | null;
};

/**
 * Один тип заданий — один файл в tasks/. Тип знает, как составить задание,
 * как разобрать ответ и как его проверить; про базу и попытки он не знает —
 * это делает tasks/index.ts.
 */
export interface Task<T extends ExerciseType> {
    type: T;
    /** Составить задание по юниту. */
    generate(unitId: number): Promise<Generated<T>>;
    /** Разобрать ответ, пришедший от клиента; ошибка — если он не той формы. */
    parseAnswer(raw: unknown, content: ContentByType[T]): AnswerByType[T];
    /** Проверить ответ. Каждая попытка проверяется независимо, без предыдущих. */
    check(unitId: number, content: ContentByType[T], answer: AnswerByType[T]): Promise<Checked>;
}

/** Ошибка, которую можно показать пользователю как есть. */
export class TaskError extends Error {}
