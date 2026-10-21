'use server';

import * as catalog from '@/server/catalog';
import type { Exercise } from '@/server/exercises/types';
import * as learner from '@/server/learner';
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

/** Следующее задание сессии в рабочей области: юнит и тип выбирает планировщик (specs/planner.md). */
export async function nextSessionExercise(workspaceId: number): Promise<Result<{ exercise: tasks.ExerciseView; targetName: string }>> {
    try {
        const plan = await learner.planNext(workspaceId);
        if (!plan) return { ok: false, error: 'Нет юнитов в работе. Отметь юнит в каталоге — наведи на его номер.' };
        const [unit, exercise] = await Promise.all([catalog.getUnit(plan.unitId), tasks.get(plan.unitId, plan.type)]);
        return { ok: true, exercise, targetName: `${unit.number ?? '—'}. ${unit.title}` };
    } catch (e) {
        return fail(e, 'Не получилось составить задание');
    }
}

/**
 * Заготовить задание, которое планировщик дал бы следующим. Не ждёт генерации:
 * ответ сразу, заготовка доделывается на сервере и отдастся по «Дальше», если план не изменится.
 */
export async function prepareNextExercise(workspaceId: number): Promise<void> {
    try {
        const plan = await learner.planNext(workspaceId);
        if (plan) tasks.prepare(plan.unitId, plan.type);
    } catch (e) {
        console.error(e);   // заготовка — только ускорение
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

/** Итог сессии по показанным в ней заданиям, по порядку показа. */
export async function sessionSummary(exerciseIds: number[]): Promise<Result<{ units: (learner.SessionUnit & { name: string })[] }>> {
    try {
        const units = await learner.sessionSummary(exerciseIds);
        const names = new Map((await catalog.getUnits(units.map((u) => u.unitId))).map((u) => [u.id, `${u.number ?? '—'}. ${u.title}`]));
        return { ok: true, units: units.map((u) => ({ ...u, name: names.get(u.unitId) ?? `Юнит ${u.unitId}` })) };
    } catch (e) {
        return fail(e, 'Не получилось собрать итог');
    }
}
