// Планировщик — specs/planner.md. Чистая функция без сети и базы: на входе
// юниты, задания и попытки как они лежат в базе, на выходе — одно следующее задание.
import type { Evaluation, ExerciseType } from '../exercises/types';
import { evidenceOf } from './evidence';
import { dueAt, interval, progress, isDue, replay, type Config, type Evidence, type UnitState } from './model';

// Типы и пороги между ними (§4) — из конфига области (c.TYPES, content/<key>/workspace.yaml).
export const PLANNER_CONFIG = {
    /** Варианты таймера, минуты. На выбор заданий не влияют — только интерфейс. */
    SESSION_OPTIONS: [5, 10, 15, 20, 30] as const,
    /**
     * В «Закреплении» вес каждой ступени ниже верхней — в столько раз меньше предыдущей (§4):
     * 0.4 при четырёх ступенях — 62 / 25 / 10 / 4%. 0 — всегда верхняя.
     */
    LOWER_TYPE_DECAY: 0.4,
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

/** Ступени лестницы, доступные при освоении M, снизу вверх: по ступени на значение fromM, группа — одна ступень. */
function stepsUpTo(M: number, c: Config): number[] {
    return [...new Set(c.TYPES.filter((t) => M >= t.fromM).map((t) => t.fromM))];
}

/**
 * Тип ступени fromM: один тип — он; группа — тот её тип, который юниту давали давнее всего
 * (никогда — раньше всех), при равенстве — первый по порядку области. shown — задания юнита.
 */
function typeAt(fromM: number, c: Config, shown: readonly { type: ExerciseType; createdAt: number }[]): ExerciseType {
    const group = c.TYPES.filter((t) => t.fromM === fromM);
    const lastShown = (type: ExerciseType) => Math.max(-Infinity, ...shown.filter((e) => e.type === type).map((e) => e.createdAt));
    return group.reduce((a, b) => (lastShown(b.type) < lastShown(a.type) ? b : a)).type;
}

/**
 * Тип по освоению без забывания на верхней ступени: последний порог fromM области, не выше M
 * (типы идут по нарастанию сложности). Без случайности.
 */
export function typeFor(M: number, c: Config, shown: readonly { type: ExerciseType; createdAt: number }[] = []): ExerciseType {
    return typeAt(stepsUpTo(M, c).at(-1)!, c, shown);
}

/**
 * Ступень для «Закрепления» (§4): случайно среди доступных, вес верхней 1, каждой ниже —
 * в decay раз меньше. Одна ступень или decay 0 — верхняя, rng не вызывается.
 */
export function consolidateStep(M: number, c: Config, rng: () => number, decay: number): number {
    const steps = stepsUpTo(M, c).reverse();   // сверху вниз
    if (steps.length === 1 || decay <= 0) return steps[0];
    const weights = steps.map((_, i) => decay ** i);
    let r = rng() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < steps.length; i++) {
        if (r < weights[i]) return steps[i];
        r -= weights[i];
    }
    return steps.at(-1)!;   // r на самой границе суммы — от плавающей точки
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

/**
 * Генератор для ступени в «Закреплении» (§4), детерминированный по юниту и числу его показанных
 * заданий (с пропущенными). Одно состояние — одна ступень: заготовка следующего задания
 * (prepareNextExercise) и сама выдача (nextSessionExercise) зовут планировщик порознь и должны
 * совпасть, иначе заготовка выбрасывается. После показа задания число растёт — и ступень разыгрывается заново.
 */
export function stepRng(unitId: number, shownCount: number): () => number {
    // Сид — перемешивание пары (murmur3 fmix32), дальше mulberry32: соседние юниты и счётчики дают несвязанные числа.
    let h = Math.imul(unitId, 0x9e3779b1) ^ Math.imul(shownCount + 1, 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    let a = (h ^ (h >>> 16)) >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Следующее задание: юнит и тип. null — начатых юнитов нет или у области нет типов. c — конфиг области.
 * rng — только для ступени в «Закреплении»; не задан — stepRng по выбранному юниту. Тесты подставляют свой.
 */
export function nextExercise(
    units: PlannerUnit[],
    exercises: PlannerExercise[],
    attempts: PlannerAttempt[],
    now: number,
    c: Config,
    rng?: () => number,
    pc: PlannerConfig = PLANNER_CONFIG,
): Plan | null {
    const candidates = units.filter((u) => u.started);
    if (!candidates.length || !c.TYPES.length) return null;

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
    const tier = TIERS[best.tier];
    // Ступень легче верхней — только в «Закреплении»: в остальных уровнях задание двигает лестницу,
    // а день в срок, обслуженный gap/choice, выше EASY_MAX_STAGE не поднимает.
    const shown = exercises.filter((e) => e.unitId === best.u.id);
    const step = tier === 'consolidate'
        ? consolidateStep(best.state.M, c, rng ?? stepRng(best.u.id, shown.length), pc.LOWER_TYPE_DECAY)
        : stepsUpTo(best.state.M, c).at(-1)!;
    return { unitId: best.u.id, type: typeAt(step, c, shown), tier };
}
