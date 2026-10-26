import 'server-only';
import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import { hasTasks, listWorkspaces } from '../catalog';
import { readSettings, workspaceContent } from '../content';
import { db } from '../db/client';
import { exerciseAttempts, exercises, units } from '../db/schema';
import { statusOf } from '../exercises';
import { evidenceOf } from './evidence';
import { interval, isMastered, level, newUnit, progress, replay, update, type Config, type Evidence, type ExerciseType } from './model';
import { nextExercise, type Plan } from './planner';

/** Окно графика рейтинга: 4 недели, точка на день — при 80px это ~3px на день. */
export const HISTORY_DAYS = 28;

/** Показатели юнита для строки каталога. */
export type UnitRating = {
    mastery: number;          // видимый уровень освоения, 0–100
    stage: number;            // ступень лестницы, 0–stageMax
    stageMax: number;
    intervalDays: number;     // интервал текущей ступени — сколько дней тема держится
    progress: number;         // общий рейтинг, 0–100
    mastered: boolean;        // прогресс дошёл до MASTERED_PROGRESS
    /** Рейтинг на конец каждого из HISTORY_DAYS дней, последний — на сейчас; null — практики ещё не было. */
    history: (number | null)[];
};

/** Прогон свидетельств юнита с замером рейтинга в каждой точке окна; c — конфиг области юнита. */
function rate(evs: Evidence[], now: number, c: Config): UnitRating {
    let s = newUnit(c);
    let i = 0;
    let seen = false;
    const history: (number | null)[] = [];
    // Прошлые точки — на конец календарного дня, последняя — на сейчас. Отсчёт
    // «now минус сутки» сливал вчерашнее занятие с сегодняшним в одну точку.
    const today = new Date(now);
    for (let d = HISTORY_DAYS - 1; d >= 0; d--) {
        const t = d ? new Date(today.getFullYear(), today.getMonth(), today.getDate() - d + 1).getTime() : now;
        for (; i < evs.length && evs[i].at <= t; i++) {
            s = update(s, evs[i], c);
            seen = true;
        }
        history.push(seen ? progress(s, t, c) : null);
    }
    for (; i < evs.length; i++) s = update(s, evs[i], c);
    return {
        mastery: level(s, now, c),
        stage: s.stage,
        stageMax: c.LADDER_DAYS.length - 1,
        intervalDays: interval(s, c),
        progress: progress(s, now, c),
        mastered: isMastered(s, now, c),
        history,
    };
}

/**
 * Отметка «в работе» — текущая: от неё зависят побочные свидетельства всего лога (evidenceOf).
 * Юнит без заданий в работе освоен по определению — побочные ошибки его не трогают, как неначатый.
 */
async function startedCheck(): Promise<(unitId: number) => boolean> {
    const rows = await db().select({ id: units.id, guide: units.guide }).from(units).where(eq(units.started, true));
    const ids = new Set(rows.filter(hasTasks).map((r) => r.id));
    return (id) => ids.has(id);
}

/** Конфиги всех областей по id: свидетельства и состояние юнита считаются по конфигу его области. */
async function configs(): Promise<Map<number, Config>> {
    return new Map((await listWorkspaces()).map((w) => [w.id, readSettings(w.key).config]));
}

/** Свидетельства юнита и конфиг его области. */
type UnitEvidence = { config: Config; evs: Evidence[] };

/**
 * Свидетельства по юнитам из всего лога, по времени. Заглушки типов (model = 'mock') всегда «верно» — их не берём.
 * Побочные юниты попытки — из области её целевого юнита (каталог проверки — его книга), конфиг у них тот же.
 */
async function loadEvidence(isStarted: (unitId: number) => boolean): Promise<Map<number, UnitEvidence>> {
    const [rows, byWorkspace] = await Promise.all([
        db()
            .select({
                at: exerciseAttempts.createdAt,
                evaluation: exerciseAttempts.evaluation,
                unitId: exercises.unitId,
                type: exercises.type,
                workspaceId: units.workspaceId,
            })
            .from(exerciseAttempts)
            .innerJoin(exercises, eq(exercises.id, exerciseAttempts.exerciseId))
            .innerJoin(units, eq(units.id, exercises.unitId))
            .where(ne(exercises.model, 'mock'))
            .orderBy(asc(exerciseAttempts.createdAt)),
        configs(),
    ]);

    const byUnit = new Map<number, UnitEvidence>();
    for (const r of rows) {
        const config = byWorkspace.get(r.workspaceId)!;
        for (const { unitId, ev } of evidenceOf({ ...r, at: r.at.getTime() }, isStarted, config)) {
            const u = byUnit.get(unitId);
            if (u) u.evs.push(ev);
            else byUnit.set(unitId, { config, evs: [ev] });
        }
    }
    return byUnit;
}

/**
 * Показатели всех юнитов, у которых есть практика. Лог — источник истины:
 * состояние каждый раз собирается заново из всех попыток. Юниты без практики
 * в результат не попадают.
 */
export async function unitRatings(now = Date.now()): Promise<Map<number, UnitRating>> {
    const ratings = new Map<number, UnitRating>();
    for (const [unitId, { config, evs }] of await loadEvidence(await startedCheck())) ratings.set(unitId, rate(evs, now, config));
    return ratings;
}

/** Три показателя юнита на момент at — как в строке каталога. */
export type Snapshot = { progress: number; mastery: number; intervalDays: number };

function snapshot(evs: Evidence[], at: number, c: Config): Snapshot | null {
    if (!evs.length) return null;
    const s = replay(evs, c);
    return { progress: progress(s, at, c), mastery: level(s, at, c), intervalDays: interval(s, c) };
}

/** Чем кончилось задание сессии; open — ответ был, но задание не завершено. */
export type TaskOutcome = 'ok' | 'bad' | 'skip' | 'open';

export type SessionUnit = {
    unitId: number;
    /** null — до сессии практики по юниту не было. */
    before: Snapshot | null;
    /** null — практики нет и после: все задания по юниту пропущены. */
    after: Snapshot | null;
    /** Задания по юниту: n — номер в сессии, с 1. */
    tasks: { n: number; type: ExerciseType; outcome: TaskOutcome }[];
    /** Номера заданий, где юнит оценён побочно. */
    sideIn: number[];
};

/** Шкалы в том виде, как их показывает итог: изменение, не видное глазу, изменением не считается. */
const shown = (s: Snapshot | null) => (s ? [Math.round(s.progress), Math.round(s.mastery), s.intervalDays] : []).join();

/**
 * Итог сессии: юниты, у которых сдвинулась хоть одна из трёх шкал, — целевые и задетые
 * побочно, порядок не задан. «До» — на начало сессии из свидетельств до неё, «после» — сейчас.
 */
export async function sessionSummary(exerciseIds: number[], now = Date.now()): Promise<SessionUnit[]> {
    if (!exerciseIds.length) return [];
    const isStarted = await startedCheck();
    const [exRows, attRows, all, byWorkspace] = await Promise.all([
        db()
            .select({ id: exercises.id, unitId: exercises.unitId, type: exercises.type, createdAt: exercises.createdAt, workspaceId: units.workspaceId })
            .from(exercises)
            .innerJoin(units, eq(units.id, exercises.unitId))
            .where(inArray(exercises.id, exerciseIds)),
        db()
            .select({ exerciseId: exerciseAttempts.exerciseId, seq: exerciseAttempts.seq, at: exerciseAttempts.createdAt, evaluation: exerciseAttempts.evaluation })
            .from(exerciseAttempts)
            .where(inArray(exerciseAttempts.exerciseId, exerciseIds)),
        loadEvidence(isStarted),
        configs(),
    ]);
    const order = new Map(exerciseIds.map((id, i) => [id, i + 1]));
    const session = exRows.map((e) => ({ ...e, n: order.get(e.id)!, attempts: attRows.filter((a) => a.exerciseId === e.id) }))
        .sort((a, b) => a.n - b.n);

    const touched = new Map<number, SessionUnit>();
    const unit = (unitId: number) => {
        let u = touched.get(unitId);
        if (!u) touched.set(unitId, (u = { unitId, before: null, after: null, tasks: [], sideIn: [] }));
        return u;
    };
    for (const e of session) {
        const status = statusOf(e.attempts);
        const outcome = status === 'accepted' ? 'ok' : status === 'failed' ? 'bad' : e.attempts.length ? 'open' : 'skip';
        unit(e.unitId).tasks.push({ n: e.n, type: e.type, outcome });
    }
    for (const e of session) {
        for (const a of e.attempts) {
            for (const { unitId, ev } of evidenceOf({ at: a.at.getTime(), unitId: e.unitId, type: e.type, evaluation: a.evaluation }, isStarted, byWorkspace.get(e.workspaceId)!)) {
                const u = unit(unitId);
                if (ev.role === 'side' && !u.sideIn.includes(e.n)) u.sideIn.push(e.n);
            }
        }
    }

    const startAt = Math.min(...session.map((e) => e.createdAt.getTime()));
    for (const u of touched.values()) {
        const ue = all.get(u.unitId);
        if (!ue) continue;   // практики нет ни до, ни после — before и after остаются null
        u.before = snapshot(ue.evs.filter((ev) => ev.at < startAt), startAt, ue.config);
        u.after = snapshot(ue.evs, now, ue.config);
    }
    return [...touched.values()].filter((u) => shown(u.before) !== shown(u.after));
}

/** Следующее задание сессии в рабочей области по планировщику; null — начатых юнитов в ней нет. */
export async function planNext(workspaceId: number, now = Date.now()): Promise<Plan | null> {
    // Заглушки в рейтинг не идут (см. unitRatings); задания других областей планировщику не нужны.
    const scope = and(ne(exercises.model, 'mock'), eq(units.workspaceId, workspaceId));
    const [{ config }, unitRows, exerciseRows, attemptRows] = await Promise.all([
        workspaceContent(workspaceId),
        db().select({ id: units.id, position: units.position, started: units.started, guide: units.guide }).from(units).where(eq(units.workspaceId, workspaceId)),
        db()
            .select({ id: exercises.id, unitId: exercises.unitId, type: exercises.type, createdAt: exercises.createdAt })
            .from(exercises)
            .innerJoin(units, eq(units.id, exercises.unitId))
            .where(scope),
        db()
            .select({ exerciseId: exerciseAttempts.exerciseId, at: exerciseAttempts.createdAt, evaluation: exerciseAttempts.evaluation })
            .from(exerciseAttempts)
            .innerJoin(exercises, eq(exercises.id, exerciseAttempts.exerciseId))
            .innerJoin(units, eq(units.id, exercises.unitId))
            .where(scope),
    ]);
    return nextExercise(
        // Юнит без заданий планировщику — как неначатый: предлагать по нему нечего.
        unitRows.map((u) => ({ id: u.id, position: u.position, started: u.started && hasTasks(u) })),
        exerciseRows.map((e) => ({ ...e, createdAt: e.createdAt.getTime() })),
        attemptRows.map((a) => ({ ...a, at: a.at.getTime() })),
        now,
        config,
    );
}
