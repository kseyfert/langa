import 'server-only';
import {
    addAttempt, createExercise, getExercise, publicContent,
    type Attempt, type Exercise, type ExerciseStatus, type ExerciseType, type PublicContentByType,
} from '../exercises';
import { choice } from './choice';
import { free } from './free';
import { gap } from './gap';
import { rephrase } from './rephrase';
import { translate } from './translate';
import { TaskError, type Task } from './types';

export { TaskError };

const TASKS: { [T in ExerciseType]: Task<T> } = { gap, choice, translate, rephrase, free };

/** Задача по типу. Связь type ↔ content TypeScript через union не проводит — здесь она гарантирована реестром. */
const taskOf = (type: ExerciseType) => TASKS[type] as Task<ExerciseType>;

/** То, что уходит клиенту: без ключей ответов. */
export type ExerciseView = {
    [T in ExerciseType]: { id: number; unitId: number; type: T; content: PublicContentByType[T] };
}[ExerciseType];

const view = (ex: Exercise): ExerciseView =>
    ({ id: ex.id, unitId: ex.unitId, type: ex.type, content: publicContent(ex) }) as ExerciseView;

/**
 * Задание по юниту и типу. Сейчас всегда новое: тип составляет, здесь оно
 * пишется в лог. Позже здесь же — иногда отдать нерешённое из базы вместо
 * генерации; файлы типов это не затронет.
 */
export async function get(unitId: number, type: ExerciseType): Promise<ExerciseView> {
    const g = await taskOf(type).generate(unitId);
    const ex = await createExercise({ unitId, type, ...g });
    return view(ex);
}

export type CheckResult = {
    attempt: Attempt;
    status: ExerciseStatus | null;
    /** Задание с ключами и объяснениями — только когда оно завершено: раньше ключ клиенту не отдаётся. */
    solution: Exercise | null;
};

/** Проверить ответ и записать попытку. */
export async function check(exerciseId: number, rawAnswer: unknown): Promise<CheckResult> {
    const ex = await getExercise(exerciseId);
    const task = taskOf(ex.type);
    // Завершённое задание отклонит и addAttempt, но проверять до него — значит не платить за проверку зря.
    if (ex.status) throw new TaskError('Задание уже завершено');
    const answer = task.parseAnswer(rawAnswer, ex.content);
    const checked = await task.check(ex.unitId, ex.content, answer);
    const attempt = await addAttempt(exerciseId, { answer, ...checked });
    const after = await getExercise(exerciseId);
    return { attempt, status: after.status, solution: after.status ? after : null };
}
