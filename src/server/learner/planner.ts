// Планировщик — specs/planner.md. Чистая функция без сети и базы: на входе
// юниты, задания и попытки как они лежат в базе, на выходе — одно следующее задание.
import { EXERCISE_TYPES, type Evaluation, type ExerciseType } from '../exercises/types';
import { evidenceOf } from './evidence';
import { CONFIG, dueAt, interval, progress, isDue, replay, type Evidence, type UnitState } from './model';

export const PLANNER_CONFIG = {
    /** Границы освоения M между gap / choice / rephrase / translate / free (§4). */
    TYPE_THRESHOLDS: [30, 42, 55, 65],
    /** Варианты таймера, минуты. На выбор заданий не влияют — только интерфейс. */
    SESSION_OPTIONS: [5, 10, 15, 20, 30] as const,
};
export type PlannerConfig = typeof PLANNER_CONFIG;

export type PlannerUnit = { id: number; position: number; started: boolean };
export type PlannerExercise = { id: number; unitId: number; type: ExerciseType; createdAt: number };
export type PlannerAttempt = { exerciseId: number; at: number; evaluation: Evaluation };

/** Уровни приоритета §3, в порядке убывания. */
export const TIERS = ['new', 'failed', 'due', 'consolidate'] as const;
export type Tier = (typeof TIERS)[number];
export type Plan = { unitId: number; type: ExerciseType; tier: Tier };

const DAY_MS = 86_400_000;

/** Тип по освоению без забывания. EXERCISE_TYPES уже идут по нарастанию сложности. */
export function typeFor(M: number, c: PlannerConfig = PLANNER_CONFIG): ExerciseType {
    return EXERCISE_TYPES[c.TYPE_THRESHOLDS.filter((t) => M >= t).length];
}

/**
 * Время провала, который ещё не снят, или null. Провал — целевое или побочное
 * свидетельство ниже FAIL_THRESHOLD; снимает его только целевое не ниже порога.
 * «Верно, но без конструкции» свидетельства не даёт и потому ничего не снимает.
 */
function openFailure(history: Evidence[]): number | null {
    let at: number | null = null;
    for (const ev of history) {
        if (ev.r < CONFIG.FAIL_THRESHOLD) at = ev.at;
        else if (ev.role === 'target') at = null;
    }
    return at;
}

/** Уровень юнита и ключ порядка внутри уровня: меньше — раньше. */
function rank(state: UnitState, history: Evidence[], attempted: boolean, now: number): { tier: Tier; key: number } {
    if (!attempted) return { tier: 'new', key: 0 };   // внутри уровня решает position
    const failedAt = openFailure(history);
    if (failedAt != null) return { tier: 'failed', key: -failedAt };
    if (isDue(state, now)) {
        // Юнит с одними «верно, но без конструкции» срока не имеет — он просрочен больше всех.
        const due = dueAt(state);
        return { tier: 'due', key: due == null ? -Infinity : -(now - due) / (interval(state) * DAY_MS) };
    }
    return { tier: 'consolidate', key: progress(state, now) };
}

/** Следующее задание: юнит и тип. null — начатых юнитов нет. */
export function nextExercise(
    units: PlannerUnit[],
    exercises: PlannerExercise[],
    attempts: PlannerAttempt[],
    now: number,
    c: PlannerConfig = PLANNER_CONFIG,
): Plan | null {
    const candidates = units.filter((u) => u.started);
    if (!candidates.length) return null;

    const exById = new Map(exercises.map((e) => [e.id, e]));
    const attempted = new Set<number>();
    const histories = new Map<number, Evidence[]>();
    for (const a of [...attempts].sort((x, y) => x.at - y.at)) {
        const ex = exById.get(a.exerciseId);
        if (!ex) continue;
        attempted.add(ex.unitId);
        for (const { unitId, ev } of evidenceOf({ at: a.at, unitId: ex.unitId, type: ex.type, evaluation: a.evaluation })) {
            const list = histories.get(unitId);
            if (list) list.push(ev);
            else histories.set(unitId, [ev]);
        }
    }

    // Без повтора подряд: последнее показанное задание считается, даже если его пропустили.
    const last = exercises.reduce<PlannerExercise | null>((l, e) => (!l || e.createdAt > l.createdAt ? e : l), null);
    const pool = last && candidates.length > 1 ? candidates.filter((u) => u.id !== last.unitId) : candidates;

    const ranked = pool.map((u) => {
        const history = histories.get(u.id) ?? [];
        const state = replay(history);
        const { tier, key } = rank(state, history, attempted.has(u.id), now);
        return { u, state, tier: TIERS.indexOf(tier), key };
    });
    ranked.sort((a, b) => a.tier - b.tier || a.key - b.key || a.u.position - b.u.position);

    const best = ranked[0];
    return { unitId: best.u.id, type: typeFor(best.state.M, c), tier: TIERS[best.tier] };
}
