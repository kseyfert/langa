import type { AnswerByType, ContentByType, Evaluation, ExerciseType, PublicContentByType } from '../exercises/types';
import type { JsonSchema } from './claude';
import type { Values } from './prompt';

/**
 * Типы, которые уже сделаны по-настоящему; остальные — заглушки и в выдачу не попадают.
 * Здесь, а не в tasks/index.ts: список нужен и клиенту (выбор типа для тестов).
 */
export const READY_TYPES = ['gap', 'choice', 'rephrase', 'translate', 'free'] as const satisfies readonly ExerciseType[];
export type ReadyType = (typeof READY_TYPES)[number];

/** Объём свободного ответа в символах. Здесь, а не в free/: рамки показывает и клиент. */
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

/** Проверка по ключу (gap, choice): верен ли каждый пункт. ClosedEvaluation собирает общий код — grade.ts. */
export type KeyCheck<T extends ExerciseType> = {
    by: 'key';
    score(content: ContentByType[T], answer: AnswerByType[T]): boolean[];
};

/**
 * Проверка моделью (открытые типы): тип отдаёт только описание задания для своего grade-user.md,
 * с эталоном. Вызов, схема ответа и нормализация — общие, grade.ts.
 */
export type ModelCheck<T extends ExerciseType> = {
    by: 'model';
    task(content: ContentByType[T]): Values;
};

/**
 * Определение типа заданий — specs/exercise-types.md. Всё, чем типы различаются; общая
 * механика (конвейер генерации, проверка, база) — в tasks/*.ts и про конкретные типы не знает.
 */
export interface TaskType<T extends ExerciseType> {
    type: T;
    /** Пунктов в плане фокуса: по пункту «Употребления» на предложение задания. */
    items: number;
    /** Схема ответа модели при генерации (structured outputs). */
    outputSchema: JsonSchema;
    /** Значения generate.md, нужные только этому типу; общие (юнит, тема, seed, фокус, недавние) подставляет конвейер. */
    generateValues?: Values;
    /** Ответ генерации → содержимое задания; plan — план фокуса, он же content.focus. Ошибка — если задания из ответа не собрать. */
    normalize(raw: unknown, plan: string[]): ContentByType[T];
    /** Что уходит клиенту до проверки: без ключей, эталонов и объяснений. */
    publicContent(content: ContentByType[T]): PublicContentByType[T];
    /** Готовые предложения задания — генератору как «уже было» (variety.ts). */
    sentences(content: ContentByType[T]): string[];
    /** Разобрать ответ, пришедший от клиента; ошибка — если он не той формы. */
    parseAnswer(raw: unknown, content: ContentByType[T]): AnswerByType[T];
    /** Каждая попытка проверяется независимо, без предыдущих. */
    check: KeyCheck<T> | ModelCheck<T>;
}

/** Ошибка, которую можно показать пользователю как есть. */
export class TaskError extends Error {}
