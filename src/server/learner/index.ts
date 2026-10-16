import 'server-only';
import { asc, eq, ne } from 'drizzle-orm';
import { db } from '../db/client';
import { exerciseAttempts, exercises } from '../db/schema';
import { evidenceOf } from './evidence';
import { CONFIG, interval, level, newUnit, progress, update, type Evidence } from './model';

/** Окно графика рейтинга: 4 недели, точка на день — при 80px это ~3px на день. */
export const HISTORY_DAYS = 28;

/** Показатели юнита для строки каталога. */
export type UnitRating = {
    mastery: number;          // видимый уровень освоения, 0–100
    stage: number;            // ступень лестницы, 0–stageMax
    stageMax: number;
    intervalDays: number;     // интервал текущей ступени — сколько дней тема держится
    progress: number;         // общий рейтинг, 0–100
    /** Рейтинг на конец каждого из HISTORY_DAYS дней, последний — на сейчас; null — практики ещё не было. */
    history: (number | null)[];
};

/** Прогон свидетельств юнита с замером рейтинга в каждой точке окна. */
function rate(evs: Evidence[], now: number): UnitRating {
    let s = newUnit();
    let i = 0;
    let seen = false;
    const history: (number | null)[] = [];
    // Прошлые точки — на конец календарного дня, последняя — на сейчас. Отсчёт
    // «now минус сутки» сливал вчерашнее занятие с сегодняшним в одну точку.
    const today = new Date(now);
    for (let d = HISTORY_DAYS - 1; d >= 0; d--) {
        const t = d ? new Date(today.getFullYear(), today.getMonth(), today.getDate() - d + 1).getTime() : now;
        for (; i < evs.length && evs[i].at <= t; i++) {
            s = update(s, evs[i]);
            seen = true;
        }
        history.push(seen ? progress(s, t) : null);
    }
    for (; i < evs.length; i++) s = update(s, evs[i]);
    return {
        mastery: level(s, now),
        stage: s.stage,
        stageMax: CONFIG.LADDER_DAYS.length - 1,
        intervalDays: interval(s),
        progress: progress(s, now),
        history,
    };
}

/**
 * Показатели всех юнитов, у которых есть практика. Лог — источник истины:
 * состояние каждый раз собирается заново из всех попыток. Юниты без практики
 * в результат не попадают.
 */
export async function unitRatings(now = Date.now()): Promise<Map<number, UnitRating>> {
    const rows = await db()
        .select({
            at: exerciseAttempts.createdAt,
            evaluation: exerciseAttempts.evaluation,
            unitId: exercises.unitId,
            type: exercises.type,
        })
        .from(exerciseAttempts)
        .innerJoin(exercises, eq(exercises.id, exerciseAttempts.exerciseId))
        // Заглушки типов, которые ещё не сделаны, всегда «верно» — в рейтинг их не пускаем.
        .where(ne(exercises.model, 'mock'))
        .orderBy(asc(exerciseAttempts.createdAt));

    const byUnit = new Map<number, Evidence[]>();
    for (const r of rows) {
        for (const { unitId, ev } of evidenceOf({ ...r, at: r.at.getTime() })) {
            const list = byUnit.get(unitId);
            if (list) list.push(ev);
            else byUnit.set(unitId, [ev]);
        }
    }

    const ratings = new Map<number, UnitRating>();
    for (const [unitId, evs] of byUnit) ratings.set(unitId, rate(evs, now));
    return ratings;
}
