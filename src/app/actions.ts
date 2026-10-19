'use server';

import * as catalog from '@/server/catalog';
import type { Exercise } from '@/server/exercises/types';
import * as tasks from '@/server/tasks';

// Ошибки возвращаются значением: брошенную из server action Next в проде прячет.
type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

function fail(e: unknown, what: string): { ok: false; error: string } {
    if (e instanceof tasks.TaskError) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: `${what}: ${e instanceof Error ? e.message : String(e)}` };
}

/** Задание по юниту: заданного типа или, если тип не задан или не готов, случайного. */
export async function startExercise(unitId: number, type: string | null = null): Promise<Result<{ exercise: tasks.ExerciseView }>> {
    try {
        const ready = tasks.READY_TYPES.find((t) => t === type);
        return { ok: true, exercise: await (ready ? tasks.get(unitId, ready) : tasks.getRandom(unitId)) };
    } catch (e) {
        return fail(e, 'Не получилось составить задание');
    }
}

/**
 * Следующее задание сессии. Пока без планировщика: случайный тип по случайному
 * юниту из взятых в работу.
 */
export async function nextSessionExercise(): Promise<Result<{ exercise: tasks.ExerciseView; targetName: string }>> {
    try {
        const unit = await catalog.randomStartedUnit();
        if (!unit) return { ok: false, error: 'Нет юнитов в работе. Отметь юнит в каталоге — наведи на его номер.' };
        return { ok: true, exercise: await tasks.getRandom(unit.id), targetName: `${unit.number ?? '—'}. ${unit.title}` };
    } catch (e) {
        return fail(e, 'Не получилось составить задание');
    }
}

/** Проверить ответ на задание. */
export async function checkExercise(exerciseId: number, answer: unknown): Promise<Result<tasks.CheckResult>> {
    try {
        return { ok: true, ...(await tasks.check(exerciseId, answer)) };
    } catch (e) {
        return fail(e, 'Не получилось проверить ответ');
    }
}

/** Разбор задания с эталоном — после «верно, но без нужной конструкции». */
export async function revealExercise(exerciseId: number): Promise<Result<{ solution: Exercise }>> {
    try {
        return { ok: true, solution: await tasks.reveal(exerciseId) };
    } catch (e) {
        return fail(e, 'Не получилось показать разбор');
    }
}

/** Отметить юнит взятым в работу или снять отметку. */
export async function setUnitStarted(unitId: number, started: boolean): Promise<Result<object>> {
    try {
        await catalog.setStarted(unitId, started);
        return { ok: true };
    } catch (e) {
        return fail(e, 'Не получилось сохранить отметку');
    }
}
