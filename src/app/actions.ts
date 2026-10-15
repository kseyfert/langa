'use server';

import * as tasks from '@/server/tasks';

// Ошибки возвращаются значением: брошенную из server action Next в проде прячет.
type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

function fail(e: unknown, what: string): { ok: false; error: string } {
    if (e instanceof tasks.TaskError) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: `${what}: ${e instanceof Error ? e.message : String(e)}` };
}

/** Задание на пропуски по юниту. */
export async function startGap(unitId: number): Promise<Result<{ exercise: tasks.ExerciseView }>> {
    try {
        return { ok: true, exercise: await tasks.get(unitId, 'gap') };
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
