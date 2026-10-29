import 'server-only';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '../db/client';
import { units, workspaces } from '../db/schema';

/** key — папка content/<key>/ с промптами, evals и настройками области. */
export type Workspace = { id: number; key: string; name: string };

/** Юнит без guide — без заданий: он в книге для полноты. В работе (started) он сразу освоен. */
export const hasTasks = (u: { guide: string }) => u.guide.trim() !== '';

export type Unit = {
    id: number;
    workspaceId: number;
    book: string;
    section: string;
    number: number | null;
    position: number;
    title: string;
    summaryRu: string;
    guide: string;
    article: string;
    buildsOn: number[];
    reviewed: boolean;
    started: boolean;
    excludeAsSide: boolean;
    updatedAt: string;
};

type Row = typeof units.$inferSelect;

function toUnit(r: Row): Unit {
    return { ...r, updatedAt: r.updatedAt.toISOString() };
}

export async function listWorkspaces(): Promise<Workspace[]> {
    return db().select({ id: workspaces.id, key: workspaces.key, name: workspaces.name }).from(workspaces).orderBy(asc(workspaces.id));
}

/** Рабочая область или null, если её нет. */
export async function getWorkspace(id: number): Promise<Workspace | null> {
    const [row] = await db().select({ id: workspaces.id, key: workspaces.key, name: workspaces.name }).from(workspaces).where(eq(workspaces.id, id));
    return row ?? null;
}

/** Юниты области в порядке position; с book — только этой книги. */
export async function listUnits(workspaceId: number, book?: string): Promise<Unit[]> {
    const rows = await db()
        .select()
        .from(units)
        .where(and(eq(units.workspaceId, workspaceId), book ? eq(units.book, book) : undefined))
        .orderBy(asc(units.position));
    return rows.map(toUnit);
}

export async function setStarted(id: number, started: boolean): Promise<void> {
    const rows = await db().update(units).set({ started }).where(eq(units.id, id)).returning({ id: units.id });
    if (!rows.length) throw new Error(`Юнит ${id} не найден`);
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

export async function catalogForPrompt(ids: number[]): Promise<string> {
    const list = await getUnits(ids);
    return list.map((u) => `${u.id}. ${u.title}`).join('\n');
}
