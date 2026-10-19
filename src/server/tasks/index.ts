import 'server-only';
import { getUnits } from '../catalog';
import {
    addAttempt, createExercise, getExercise, isOpenEvaluation, publicContent,
    type Attempt, type Exercise, type ExerciseStatus, type ExerciseType, type PublicContentByType,
} from '../exercises';
import { choice } from './choice';
import { free } from './free';
import { gap } from './gap';
import { rephrase } from './rephrase';
import { translate } from './translate';
import { READY_TYPES, TaskError, type Generated, type Task } from './types';

export { READY_TYPES, TaskError };

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
 * Заготовка следующего задания сессии. Живёт в памяти сервера, а не в базе:
 * задание в базе — это показанное задание, а непоказанная заготовка сбила бы
 * планировщику «последнее показанное». Одна на сервер — пользователь один.
 */
let ahead: { unitId: number; type: ExerciseType; content: Promise<Generated<ExerciseType> | null> } | null = null;

/** Начать составлять задание заранее. Такое же уже готовится — ничего не делать; другое — заменить. */
export function prepare(unitId: number, type: ExerciseType): void {
    if (ahead?.unitId === unitId && ahead.type === type) return;
    // Неудача заготовки не ошибка: по «Дальше» задание составится обычным путём.
    ahead = { unitId, type, content: taskOf(type).generate(unitId).catch(() => null) };
}

/**
 * Задание по юниту и типу: заготовка, если она под эти юнит и тип, иначе
 * новое. В лог пишется в момент выдачи — время задания и есть время показа.
 */
export async function get(unitId: number, type: ExerciseType): Promise<ExerciseView> {
    const ready = ahead?.unitId === unitId && ahead.type === type ? ahead.content : null;
    if (ready) ahead = null;
    const g = (await ready) ?? (await taskOf(type).generate(unitId));
    const ex = await createExercise({ unitId, type, ...g });
    return view(ex);
}

/** Задание по юниту случайного готового типа. */
export const getRandom = (unitId: number) => get(unitId, READY_TYPES[Math.floor(Math.random() * READY_TYPES.length)]);

export type CheckResult = {
    attempt: Attempt;
    status: ExerciseStatus | null;
    /** Задание с ключами и объяснениями — только когда оно завершено: раньше ключ клиенту не отдаётся. */
    solution: Exercise | null;
    /** Предложение попробовать ещё раз — после «верно, но без целевой конструкции»; иначе null. */
    retryRu: string | null;
    /** Названия юнитов из оценки открытого ответа: id → «номер. название». */
    units: Record<number, string>;
};

const unitName = (u: { number: number | null; title: string }) => `${u.number ?? '—'}. ${u.title}`;

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
    const ev = attempt.evaluation;
    const named = isOpenEvaluation(ev) ? await getUnits([ex.unitId, ...ev.others.map((o) => o.unit_id)]) : [];
    // Текст формирует сервер, а не модель (exercise-spec §8): так в нём нет подсказки, как надо.
    const target = named.find((u) => u.id === ex.unitId);
    const retryRu = isOpenEvaluation(ev) && ev.verdict === 'correct_non_target' && target
        ? `Верно. А теперь напиши ответ с конструкцией из юнита ${unitName(target)}.`
        : null;
    return {
        attempt,
        status: after.status,
        solution: after.status ? after : null,
        retryRu,
        units: Object.fromEntries(named.map((u) => [u.id, unitName(u)])),
    };
}

/**
 * Разбор незавершённого задания — «Показать разбор» после «верно, но без конструкции».
 * Статус не меняется и на рейтинг не влияет (exercise-spec §6); до первой попытки ключ не отдаётся.
 */
export async function reveal(exerciseId: number): Promise<Exercise> {
    const ex = await getExercise(exerciseId);
    if (!ex.attempts.length) throw new TaskError('Сначала ответь на задание');
    return ex;
}
