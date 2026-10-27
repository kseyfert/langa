// Конфиг модели ученика и планировщика для области: общие умолчания (model.ts, DEFAULTS)
// плюс настройки области — лестница типов и переопределения из content/<key>/workspace.yaml.
// Чистый модуль: файл читает content/, сюда приходят уже разобранные значения.
import { EXERCISE_TYPES, type ExerciseType } from '../exercises/types';
import { DEFAULTS, type Config, type RatingConstants } from './model';

/** Ступень лестницы типов области (workspace.yaml, types). */
export type TypeStep = {
    type: ExerciseType;
    /** С какого освоения M планировщик даёт этот тип; у первого — 0. Соседи с одним fromM — группа, их чередуют. */
    fromM: number;
    difficulty: number;
    levelCap: number;
    memoryWeight: number;
    easy: boolean;
};

const STEP_KEYS = ['type', 'fromM', 'difficulty', 'levelCap', 'memoryWeight', 'easy'] as const;
/** Что у типов одной группы (одинаковый fromM) обязано совпадать. */
const GROUP_KEYS = ['difficulty', 'levelCap', 'memoryWeight', 'easy'] as const;

/** Допустимые значения общих констант — колонка «Диапазон» rating-model.md §0. int — только целые. */
const RANGES: { [K in keyof RatingConstants]?: { min: number; max: number; int?: boolean } } = {
    INITIAL_MASTERY: { min: 0, max: 30 },
    ELO_SCALE: { min: 6, max: 25 },
    K_TARGET: { min: 5, max: 30 },
    K_SIDE: { min: 0, max: 15 },
    SUCCESS_THRESHOLD: { min: 0.6, max: 0.95 },
    FAIL_THRESHOLD: { min: 0.3, max: 0.7 },
    PROMOTE_MIN_CREDIT: { min: 0, max: 1 },
    EASY_MAX_STAGE: { min: 1, max: 5, int: true },
    EARLY_FRACTION: { min: 0.3, max: 1 },
    FAIL_STAGE_DROP: { min: 1, max: 3, int: true },
    SIDE_ERROR_STAGE_DROP: { min: 0, max: 2, int: true },
    DAY_START_HOUR: { min: 0, max: 8, int: true },
    RETENTION_AT_DUE: { min: 0.8, max: 0.95 },
    PROGRESS_FLOOR: { min: 0, max: 70 },
    PROGRESS_FULL_INTERVAL: { min: 14, max: 120 },
    MASTERED_PROGRESS: { min: 60, max: 95 },
};

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const inRange = (v: unknown, min: number, max: number, int = false) => isNum(v) && v >= min && v <= max && (!int || Number.isInteger(v));

/** Что не так в общих константах после переопределений; пусто — всё в порядке. */
function ratingProblems(rating: Record<string, unknown>, c: Record<string, unknown>): string[] {
    const out = Object.keys(rating).filter((k) => !(k in DEFAULTS)).map((k) => `rating.${k}: такой константы нет`);
    for (const [k, r] of Object.entries(RANGES)) {
        if (!inRange(c[k], r.min, r.max, r.int)) out.push(`${k}: ${JSON.stringify(c[k])}, нужно ${r.int ? 'целое ' : ''}${r.min}–${r.max}`);
    }
    const ladder = c.LADDER_DAYS;
    const ladderOk = Array.isArray(ladder) && ladder.length >= 5 && ladder.length <= 12
        && ladder.every((d, i) => Number.isInteger(d) && d > 0 && (i === 0 || d > ladder[i - 1]))
        && ladder.at(-1) >= 60 && ladder.at(-1) <= 365;
    if (!ladderOk) out.push(`LADDER_DAYS: ${JSON.stringify(ladder)}, нужно 5–12 целых по возрастанию, последняя 60–365`);
    if (isNum(c.K_SIDE) && isNum(c.K_TARGET) && c.K_SIDE > c.K_TARGET) out.push('K_SIDE больше K_TARGET');
    if (isNum(c.SUCCESS_THRESHOLD) && isNum(c.FAIL_THRESHOLD) && c.SUCCESS_THRESHOLD <= c.FAIL_THRESHOLD) out.push('SUCCESS_THRESHOLD не больше FAIL_THRESHOLD');
    if (ladderOk && isNum(c.EASY_MAX_STAGE) && c.EASY_MAX_STAGE >= (ladder as number[]).length) out.push('EASY_MAX_STAGE за пределами LADDER_DAYS');
    return out;
}

/** Что не так в лестнице типов; пусто — всё в порядке. */
function typeProblems(types: unknown): string[] {
    if (!Array.isArray(types) || !types.length) return ['types: нужен непустой список'];
    const out: string[] = [];
    const seen = new Set<unknown>();
    types.forEach((t: Record<string, unknown>, i) => {
        const at = `types[${i}]${typeof t?.type === 'string' ? ` (${t.type})` : ''}`;
        if (!t || typeof t !== 'object') return out.push(`${at}: нужен объект`);
        const extra = Object.keys(t).filter((k) => !(STEP_KEYS as readonly string[]).includes(k));
        if (extra.length) out.push(`${at}: лишние поля ${extra.join(', ')}`);
        if (!(EXERCISE_TYPES as readonly unknown[]).includes(t.type)) out.push(`${at}: type — один из ${EXERCISE_TYPES.join(', ')}`);
        if (seen.has(t.type)) out.push(`${at}: тип повторяется`);
        seen.add(t.type);
        const prev = types[i - 1] as Record<string, unknown> | undefined;
        if (i === 0 ? t.fromM !== 0 : !inRange(t.fromM, 0, 100) || !(isNum(prev?.fromM) && (t.fromM as number) >= prev.fromM)) {
            out.push(`${at}: fromM ${JSON.stringify(t.fromM)} — у первого типа 0, дальше 0–100 по неубыванию`);
        } else if (i > 0 && t.fromM === 0) {
            out.push(`${at}: fromM 0 — группа с первым типом невозможна`);
        }
        if (!inRange(t.difficulty, 0, 100) || (i > 0 && isNum(prev?.difficulty) && (t.difficulty as number) < prev.difficulty)) {
            out.push(`${at}: difficulty ${JSON.stringify(t.difficulty)} — 0–100, по неубыванию`);
        }
        // Соседи с одним fromM — группа: планировщик их чередует, поэтому и для модели они одно и то же.
        if (i > 0 && isNum(t.fromM) && t.fromM === prev?.fromM) {
            const differ = GROUP_KEYS.filter((k) => t[k] !== prev[k]);
            if (differ.length) out.push(`${at}: в группе с ${String(prev.type)} (fromM ${t.fromM}) должны совпадать ${differ.join(', ')}`);
        }
        if (!inRange(t.levelCap, 30, 100) || (isNum(t.difficulty) && (t.levelCap as number) <= t.difficulty)) {
            out.push(`${at}: levelCap ${JSON.stringify(t.levelCap)} — 30–100, выше difficulty`);
        }
        if (!inRange(t.memoryWeight, 0, 1)) out.push(`${at}: memoryWeight ${JSON.stringify(t.memoryWeight)} — 0–1`);
        if (typeof t.easy !== 'boolean') out.push(`${at}: easy — true или false`);
    });
    return out;
}

/**
 * Конфиг области из её настроек. Значения вне диапазонов rating-model.md §0 — ошибка
 * со списком всех проблем: такой конфиг не должен дойти до модели.
 */
export function learnerConfig(types: unknown, rating: unknown = {}): Config {
    const r = (rating ?? {}) as Record<string, unknown>;
    const merged = { ...DEFAULTS, ...r };
    const problems = [
        ...(typeof r === 'object' && !Array.isArray(r) ? ratingProblems(r, merged) : ['rating: нужен объект']),
        ...typeProblems(types),
    ];
    if (problems.length) throw new Error(problems.join('; '));
    const steps = types as TypeStep[];
    const by = <V>(f: (t: TypeStep) => V) => Object.fromEntries(steps.map((t) => [t.type, f(t)])) as Record<ExerciseType, V>;
    return {
        ...(merged as RatingConstants),
        TYPES: steps.map(({ type, fromM }) => ({ type, fromM })),
        DIFFICULTY: by((t) => t.difficulty),
        LEVEL_CAP: by((t) => t.levelCap),
        MEMORY_WEIGHT: by((t) => t.memoryWeight),
        EASY_TYPES: steps.filter((t) => t.easy).map((t) => t.type),
    };
}
