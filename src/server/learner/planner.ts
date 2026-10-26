// Планировщик — specs/planner.md. Чистая функция без сети и базы: на входе
// юниты, задания и попытки как они лежат в базе, на выходе — одно следующее задание.
import type { Evaluation, ExerciseType } from '../exercises/types';
import { evidenceOf } from './evidence';
import { dueAt, interval, progress, isDue, replay, type Config, type Evidence, type UnitState } from './model';

// Типы и пороги между ними (§4) — из конфига области (c.TYPES, content/<key>/workspace.yaml).
export const PLANNER_CONFIG = {
    /** Варианты таймера, минуты. На выбор заданий не влияют — только интерфейс. */
    SESSION_OPTIONS: [5, 10, 15, 20, 30] as const,
};

export type PlannerUnit = { id: number; position: number; started: boolean };
export type PlannerExercise = { id: number; unitId: number; type: ExerciseType; createdAt: number };
export type PlannerAttempt = { exerciseId: number; at: number; evaluation: Evaluation };

/** Уровни приоритета §3, в порядке убывания. */
export const TIERS = ['new', 'failed', 'due', 'consolidate'] as const;
export type Tier = (typeof TIERS)[number];
export type Plan = { unitId: number; type: ExerciseType; tier: Tier };

const DAY_MS = 86_400_000;

/** Тип по освоению без забывания: последний тип области, чей порог fromM не выше M. Типы идут по нарастанию сложности. */
export function typeFor(M: number, c: Config): ExerciseType {
    return c.TYPES.findLast((t) => M >= t.fromM)!.type;
}

/**
 * Время провала, который ещё не снят, или null. Провал — целевое или побочное
 * свидетельство ниже FAIL_THRESHOLD; снимает его только целевое не ниже порога.
 * «Верно, но без конструкции» свидетельства не даёт и потому ничего не снимает.
 */
function openFailure(history: Evidence[], c: Config): number | null {
    let at: number | null = null;
    for (const ev of history) {
        if (ev.r < c.FAIL_THRESHOLD) at = ev.at;
        else if (ev.role === 'target') at = null;
    }
    return at;
}

/** Уровень юнита и ключ порядка внутри уровня: меньше — раньше. */
function rank(state: UnitState, history: Evidence[], attempted: boolean, now: number, c: Config): { tier: Tier; key: number } {
    if (!attempted) return { tier: 'new', key: 0 };   // внутри уровня решает position
    const failedAt = openFailure(history, c);
    if (failedAt != null) return { tier: 'failed', key: -failedAt };
    if (isDue(state, now, c)) {
        // Юнит с одними «верно, но без конструкции» срока не имеет — он просрочен больше всех.
        const due = dueAt(state, c);
        return { tier: 'due', key: due == null ? -Infinity : -(now - due) / (interval(state, c) * DAY_MS) };
    }
    return { tier: 'consolidate', key: progress(state, now, c) };
}

/** Следующее задание: юнит и тип. null — начатых юнитов нет. c — конфиг области. */
export function nextExercise(
    units: PlannerUnit[],
    exercises: PlannerExercise[],
    attempts: PlannerAttempt[],
    now: number,
    c: Config,
): Plan | null {
    const candidates = units.filter((u) => u.started);
    if (!candidates.length) return null;

    const exById = new Map(exercises.map((e) => [e.id, e]));
    const startedIds = new Set(candidates.map((u) => u.id));
    const isStarted = (id: number) => startedIds.has(id);
    const attempted = new Set<number>();
    const histories = new Map<number, Evidence[]>();
    for (const a of [...attempts].sort((x, y) => x.at - y.at)) {
        const ex = exById.get(a.exerciseId);
        if (!ex) continue;
        attempted.add(ex.unitId);
        for (const { unitId, ev } of evidenceOf({ at: a.at, unitId: ex.unitId, type: ex.type, evaluation: a.evaluation }, isStarted, c)) {
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
        const state = replay(history, c);
        const { tier, key } = rank(state, history, attempted.has(u.id), now, c);
        return { u, state, tier: TIERS.indexOf(tier), key };
    });
    ranked.sort((a, b) => a.tier - b.tier || a.key - b.key || a.u.position - b.u.position);

    const best = ranked[0];
    return { unitId: best.u.id, type: typeFor(best.state.M, c), tier: TIERS[best.tier] };
}
