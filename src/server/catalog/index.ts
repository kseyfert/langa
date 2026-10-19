import 'server-only';
import { asc, eq, and, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { units } from '../db/schema';

export type Unit = {
    id: number;
    book: string;
    section: string;
    number: number | null;
    position: number;
    title: string;
    summaryRu: string;
    guide: string;
    buildsOn: number[];
    reviewed: boolean;
    started: boolean;
    updatedAt: string;
};

type Row = typeof units.$inferSelect;

function toUnit(r: Row): Unit {
    return { ...r, updatedAt: r.updatedAt.toISOString() };
}

export async function listUnits(book?: string): Promise<Unit[]> {
    const rows = await db()
        .select()
        .from(units)
        .where(book ? eq(units.book, book) : undefined)
        .orderBy(asc(units.position));
    return rows.map(toUnit);
}

export async function setStarted(id: number, started: boolean): Promise<void> {
    const rows = await db().update(units).set({ started }).where(eq(units.id, id)).returning({ id: units.id });
    if (!rows.length) throw new Error(`Юнит ${id} не найден`);
}

/** Случайный юнит из взятых в работу; null — таких нет. */
export async function randomStartedUnit(): Promise<Unit | null> {
    const [row] = await db().select().from(units).where(eq(units.started, true)).orderBy(sql`random()`).limit(1);
    return row ? toUnit(row) : null;
}

export async function getUnit(id: number): Promise<Unit> {
    const [row] = await db().select().from(units).where(eq(units.id, id));
    if (!row) throw new Error(`Юнит ${id} не найден`);
    return toUnit(row);
}

export async function getUnits(ids: number[]): Promise<Unit[]> {
    if (!ids.length) return [];
    const rows = await db().select().from(units).where(inArray(units.id, ids)).orderBy(asc(units.position));
    return rows.map(toUnit);
}

export async function findByNumber(book: string, number: number): Promise<Unit | null> {
    const [row] = await db()
        .select()
        .from(units)
        .where(and(eq(units.book, book), eq(units.number, number)));
    return row ? toUnit(row) : null;
}

/** Запрос из одних цифр — номер юнита; иначе подстрока в названии, описании или разделе. */
export async function searchUnits(query: string): Promise<Unit[]> {
    const q = query.trim();
    if (!q) return listUnits();
    // Юнитов сотни, а не тысячи: фильтр в памяти проще, чем ilike по трём полям с экранированием.
    const all = await listUnits();
    if (/^\d+$/.test(q)) return all.filter((u) => u.number === Number(q));
    const needle = q.toLowerCase();
    return all.filter((u) =>
        [u.title, u.summaryRu, u.section].some((s) => s.toLowerCase().includes(needle)),
    );
}

export async function unitForPrompt(id: number): Promise<string> {
    const u = await getUnit(id);
    const head = `${u.book} · ${u.section} · Unit ${u.number ?? '—'}: ${u.title}`;
    // Пока описания не сгенерированы, в промпт идёт однострочное summary_ru.
    const body = u.guide.trim() || u.summaryRu;
    return body ? `${head}\n\n${body}` : head;
}

export async function catalogForPrompt(ids: number[]): Promise<string> {
    const list = await getUnits(ids);
    return list.map((u) => `${u.id}. ${u.title}`).join('\n');
}
