// Модель ученика — эталонная реализация из specs/rating-model.md, приложение A,
// перенесена как есть: при расхождении прав документ. Чистые функции, без сети и базы.
import type { ExerciseType } from '../exercises/types';
export type { ExerciseType };

// Reference implementation of the unit rating model: Elo mastery + a ladder of review intervals.
// Pure functions, no I/O. All tunable numbers live in CONFIG.


export const CONFIG = {
  // --- mastery (Elo) ---
  INITIAL_MASTERY: 10,
  DIFFICULTY: { gap: 20, choice: 30, rephrase: 50, translate: 60, free: 70 } as Record<ExerciseType, number>,
  LEVEL_CAP: { gap: 50, choice: 60, rephrase: 80, translate: 90, free: 100 } as Record<ExerciseType, number>,
  ELO_SCALE: 12,
  K_TARGET: 20,
  K_SIDE: 6,

  // --- review ladder ---
  LADDER_DAYS: [1, 2, 4, 7, 14, 30, 60, 120],
  MEMORY_WEIGHT: { gap: 0.2, choice: 0.25, rephrase: 0.6, translate: 0.8, free: 1.0 } as Record<ExerciseType, number>,
  SUCCESS_THRESHOLD: 0.8,
  FAIL_THRESHOLD: 0.5,
  PROMOTE_MIN_CREDIT: 0.2,
  EASY_TYPES: ["gap", "choice"] as ExerciseType[],
  EASY_MAX_STAGE: 3,
  EARLY_FRACTION: 0.5,
  FAIL_STAGE_DROP: 2,
  SIDE_ERROR_STAGE_DROP: 1,
  DAY_START_HOUR: 4,

  // --- forgetting (display) ---
  RETENTION_AT_DUE: 0.9,

  // --- progress ---
  PROGRESS_FLOOR: 40,
  PROGRESS_FULL_INTERVAL: 30,
  MASTERED_PROGRESS: 80,
};
export type Config = typeof CONFIG;

const DAY_MS = 86_400_000;
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

export type DayItem = { w: number; r: number; p: number; easy: boolean };
export type Day = {
  key: string;
  stage0: number;            // stage at the start of the day (after side-error drops)
  wasDue: boolean;           // whether enough of the interval had passed at the start of the day
  items: DayItem[];
  sideDropApplied: boolean;
  scheduleFrom: number;      // time the next due date counts from if the day changes the ladder
};
export type UnitState = {
  M: number;                 // mastery at lastSeen, 0..100
  stage: number;             // index in LADDER_DAYS
  lastSeen: number | null;   // last practice of any kind (ms)
  dueFrom: number | null;    // the interval of the current stage counts from this time (ms)
  day: Day | null;
};

export type Evidence = { at: number; role: "target" | "side"; type: ExerciseType; r: number };

/** How one attempt went for its target unit. A correct_non_target attempt gives no target evidence. */
export type TargetOutcome =
  | { kind: "share"; correct: number; total: number }   // gap / choice: share of correct items
  | { kind: "used"; score: number }                     // open types: target structure used, graded 0..100
  | { kind: "not_used" };                               // open types: incorrect without the target structure

/** Result r for the target unit, or null when there is nothing to count. */
export function targetResult(o: TargetOutcome, c: Config = CONFIG): number | null {
  if (o.kind === "share") return o.total ? o.correct / o.total : null;
  if (o.kind === "used") return clamp(o.score / 100, 0, 1);
  return 0;
}

export function newUnit(c: Config = CONFIG): UnitState {
  return { M: c.INITIAL_MASTERY, stage: 0, lastSeen: null, dueFrom: null, day: null };
}

export const interval = (u: UnitState, c: Config = CONFIG) => c.LADDER_DAYS[u.stage];

/** Next review date (ms), or null for a unit never practised (due right away). */
export function dueAt(u: UnitState, c: Config = CONFIG): number | null {
  return u.dueFrom == null ? null : u.dueFrom + interval(u, c) * DAY_MS;
}
export function isDue(u: UnitState, now: number, c: Config = CONFIG): boolean {
  const d = dueAt(u, c);
  return d == null || now >= d;
}

/** Level shown to the user, 0..100: mastery minus forgetting since the last practice (display and planning only). */
export function level(u: UnitState, now: number, c: Config = CONFIG): number {
  if (u.lastSeen == null) return u.M;
  const t = Math.max(0, now - u.lastSeen) / DAY_MS;
  return u.M * Math.pow(c.RETENTION_AT_DUE, t / interval(u, c));
}

/** One number for "how far the unit is done", 0..100. */
export function progress(u: UnitState, now: number, c: Config = CONFIG): number {
  const cap = c.PROGRESS_FLOOR + (100 - c.PROGRESS_FLOOR) * Math.min(1, interval(u, c) / c.PROGRESS_FULL_INTERVAL);
  return Math.min(level(u, now, c), cap);
}
export const isMastered = (u: UnitState, now: number, c: Config = CONFIG) => progress(u, now, c) >= c.MASTERED_PROGRESS;

export function expected(E: number, type: ExerciseType, c: Config = CONFIG): number {
  return 1 / (1 + Math.exp((c.DIFFICULTY[type] - E) / c.ELO_SCALE));
}

export function dayKey(at: number, c: Config = CONFIG): string {
  const d = new Date(at - c.DAY_START_HOUR * 3_600_000);    // late-night practice counts to the previous day
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** Stage and schedule after the day so far, recomputed from the start of the day each time. */
function applyDay(u: UnitState, c: Config): void {
  const day = u.day!;
  const items = day.items;
  let stage = day.stage0;
  let moved = day.sideDropApplied;                // a side-error drop restarts the interval
  if (items.length) {
    const wSum = items.reduce((s, i) => s + i.w, 0);
    const credit = items.reduce((s, i) => s + i.w * i.r, 0);
    const rBar = credit / wSum;
    const pBar = items.reduce((s, i) => s + i.w * i.p, 0) / wSum;
    if (rBar >= c.SUCCESS_THRESHOLD) {
      if (day.wasDue) {
        const maxStage = items.every(i => i.easy) ? c.EASY_MAX_STAGE : c.LADDER_DAYS.length - 1;
        if (credit >= c.PROMOTE_MIN_CREDIT && stage < maxStage) stage += 1;   // not enough practice: same stage, interval starts again
        moved = true;
      }
      // early success: practice counts for mastery only, the schedule stays as it was
    } else if (rBar < c.FAIL_THRESHOLD) {
      stage -= Math.max(1, Math.round(c.FAIL_STAGE_DROP * pBar));   // a surprising failure drops further
      moved = true;
    } else if (day.wasDue) {
      moved = true;                               // middle day: same stage, interval starts again
    }
  }
  u.stage = clamp(stage, 0, c.LADDER_DAYS.length - 1);
  if (moved) u.dueFrom = day.scheduleFrom;
}

/** Apply one piece of evidence. Returns a new state; the input is not mutated. */
export function update(prev: UnitState, ev: Evidence, c: Config = CONFIG): UnitState {
  const u: UnitState = structuredClone(prev);

  // mastery: measured skill, updated from the stored value (forgetting is handled by the ladder, not here)
  let E = u.M;
  const p = expected(E, ev.type, c);
  const K = ev.role === "target" ? c.K_TARGET : c.K_SIDE;
  // A side unit can only be penalised: its evidence never raises mastery.
  const delta = ev.role === "target" ? K * (clamp(ev.r, 0, 1) - p) : Math.min(0, K * (clamp(ev.r, 0, 1) - p));
  E = delta > 0 ? Math.max(E, Math.min(E + delta, c.LEVEL_CAP[ev.type])) : E + delta;
  u.M = clamp(E, 0, 100);

  // ladder
  const key = dayKey(ev.at, c);
  if (!u.day || u.day.key !== key) {
    const elapsed = u.dueFrom == null ? Infinity : (ev.at - u.dueFrom) / DAY_MS;
    u.day = { key, stage0: u.stage, wasDue: elapsed >= c.EARLY_FRACTION * interval(u, c), items: [], sideDropApplied: false, scheduleFrom: ev.at };
  }
  if (ev.role === "target") {
    u.day.scheduleFrom = ev.at;
    u.day.items.push({ w: c.MEMORY_WEIGHT[ev.type], r: ev.r, p, easy: c.EASY_TYPES.includes(ev.type) });
  } else if (ev.r < c.FAIL_THRESHOLD && !u.day.sideDropApplied) {
    u.day.sideDropApplied = true;
    u.day.scheduleFrom = ev.at;                   // the drop restarts the interval from the error
    u.day.stage0 = Math.max(0, u.day.stage0 - c.SIDE_ERROR_STAGE_DROP);
  }
  if (u.dueFrom == null) u.dueFrom = ev.at;
  applyDay(u, c);

  // A side use is not a practice of that unit: it never refreshes memory.
  if (ev.role === "target") u.lastSeen = ev.at;
  return u;
}

/** Rebuild a unit's state from its full evidence history (the attempt log is the source of truth). */
export function replay(history: Evidence[], c: Config = CONFIG): UnitState {
  return [...history].sort((a, b) => a.at - b.at).reduce((u, ev) => update(u, ev, c), newUnit(c));
}
