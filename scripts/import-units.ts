/**
 * Импорт юнитов из CSV в таблицу units.
 *
 *   npm run import:units -- data/units.csv
 *
 * Колонки (по имени, порядок любой):
 *   book, section, title  — обязательные
 *   number                — номер в книге; пусто — свой юнит вне книги
 *   position              — пусто — number × 10; для юнита без номера обязателен
 *   summary_ru, guide     — текст; guide может быть многострочным в кавычках
 *   builds_on             — НОМЕРА юнитов той же книги через пробел или «;»
 *                           (id в момент составления CSV ещё неизвестны)
 *   reviewed              — true / false, пусто — false
 *
 * CSV — источник правды: если юнит уже есть (та же книга и номер, а у юнита
 * без номера — та же position), все его поля из CSV перезаписываются, id остаётся.
 * Всё в одной транзакции: ошибка в любой строке — в базе ничего не меняется.
 */
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { loadEnvConfig } from '@next/env';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { units } from '../src/server/db/schema';

// Не через src/server/db/client: он помечен server-only и вне Next не импортируется.
loadEnvConfig(process.cwd());

const REQUIRED = ['book', 'section', 'title'];
const OPTIONAL = ['number', 'position', 'summary_ru', 'guide', 'builds_on', 'reviewed'];

/** Разбор CSV с кавычками: в названиях бывают запятые, в guide — переводы строк. */
function parseCsv(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (quoted) {
            if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
            else if (ch === '"') quoted = false;
            else field += ch;
        } else if (ch === '"') quoted = true;
        else if (ch === ',') { row.push(field); field = ''; }
        else if (ch === '\n' || ch === '\r') {
            if (ch === '\r' && text[i + 1] === '\n') i++;
            row.push(field); rows.push(row); row = []; field = '';
        } else field += ch;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    return rows.filter((r) => r.some((f) => f.trim()));
}

type Row = {
    line: number;
    book: string;
    section: string;
    number: number | null;
    position: number;
    title: string;
    summaryRu: string;
    guide: string;
    buildsOn: number[];   // номера юнитов той же книги
    reviewed: boolean;
};

function parseRows(text: string): { rows: Row[]; hasBuildsOn: boolean } {
    const [header, ...body] = parseCsv(text.replace(/^﻿/, ''));
    const cols = header.map((h) => h.trim());
    const missing = REQUIRED.filter((c) => !cols.includes(c));
    const unknown = cols.filter((c) => !REQUIRED.includes(c) && !OPTIONAL.includes(c));
    if (missing.length || unknown.length) {
        throw new Error(
            [missing.length && `нет колонок: ${missing.join(', ')}`, unknown.length && `лишние колонки: ${unknown.join(', ')}`]
                .filter(Boolean).join('; '),
        );
    }

    const errors: string[] = [];
    const int = (s: string, what: string, line: number): number | null => {
        if (!s) return null;
        const n = Number(s);
        if (!Number.isInteger(n) || n < 1) { errors.push(`строка ${line}: ${what} «${s}» — не целое положительное`); return null; }
        return n;
    };

    const rows = body.map((r, i): Row => {
        const line = i + 2;
        const get = (c: string) => {
            const idx = cols.indexOf(c);
            return idx < 0 ? '' : (r[idx] ?? '');
        };
        const book = get('book').trim();
        const section = get('section').trim();
        const title = get('title').trim();
        if (!book || !section || !title) errors.push(`строка ${line}: пустые book, section или title`);

        const number = int(get('number').trim(), 'number', line);
        let position = int(get('position').trim(), 'position', line);
        if (position == null && number != null) position = number * 10;
        if (position == null) errors.push(`строка ${line}: у юнита без номера нужна position`);

        const reviewedRaw = get('reviewed').trim().toLowerCase();
        if (!['', 'true', 'false'].includes(reviewedRaw)) errors.push(`строка ${line}: reviewed «${reviewedRaw}» — нужно true или false`);

        const buildsOn = get('builds_on').split(/[\s;]+/).filter(Boolean)
            .map((s) => int(s, 'builds_on', line)).filter((n): n is number => n != null);

        return {
            line, book, section, number, position: position ?? 0, title,
            summaryRu: get('summary_ru').trim(),
            guide: get('guide').trim(),
            buildsOn,
            reviewed: reviewedRaw === 'true',
        };
    });

    const seen = new Map<string, number>();
    for (const r of rows) {
        for (const key of [r.number != null ? `${r.book}#${r.number}` : null, `pos ${r.position}`]) {
            if (!key) continue;
            if (seen.has(key)) errors.push(`строка ${r.line}: повтор ${key} (уже в строке ${seen.get(key)})`);
            else seen.set(key, r.line);
        }
        if (r.number != null && r.buildsOn.includes(r.number)) errors.push(`строка ${r.line}: юнит ссылается сам на себя`);
    }

    if (errors.length) throw new Error(errors.join('\n'));
    return { rows, hasBuildsOn: cols.includes('builds_on') };
}

async function main() {
    const { positionals } = parseArgs({ allowPositionals: true });
    const file = positionals[0];
    if (!file) throw new Error('Укажи CSV: npm run import:units -- data/units.csv');
    const { rows, hasBuildsOn } = parseRows(readFileSync(file, 'utf8'));

    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL не задан — см. .env.example');
    const client = postgres(url, { max: 1 });
    try {
        const result = await drizzle(client).transaction(async (tx) => {
            const values = (rs: Row[]) => rs.map(({ line, buildsOn, ...v }) => v);
            const overwrite = {
                book: sql`excluded.book`,
                section: sql`excluded.section`,
                number: sql`excluded.number`,
                position: sql`excluded.position`,
                title: sql`excluded.title`,
                summaryRu: sql`excluded.summary_ru`,
                guide: sql`excluded.guide`,
                reviewed: sql`excluded.reviewed`,
            };
            // xmax = 0 только у только что вставленной строки — так отличаем новые от обновлённых.
            const inserted = sql<boolean>`(xmax = 0)`;

            // Две вставки: у юнита без номера unique (book, number) не срабатывает
            // (null не равен null), его узнаём по position.
            const numbered = rows.filter((r) => r.number != null);
            const own = rows.filter((r) => r.number == null);
            const done = [
                ...(numbered.length
                    ? await tx.insert(units).values(values(numbered))
                        .onConflictDoUpdate({ target: [units.book, units.number], set: overwrite })
                        .returning({ inserted })
                    : []),
                ...(own.length
                    ? await tx.insert(units).values(values(own))
                        .onConflictDoUpdate({ target: units.position, set: overwrite })
                        .returning({ inserted })
                    : []),
            ];

            // builds_on — после вставки: только теперь у всех юнитов есть id.
            if (hasBuildsOn) {
                const books = [...new Set(rows.map((r) => r.book))];
                const known = await tx.select({ id: units.id, book: units.book, number: units.number })
                    .from(units).where(inArray(units.book, books));
                const idOf = new Map(known.map((u) => [`${u.book}#${u.number}`, u.id]));
                const missing: string[] = [];
                for (const r of rows) {
                    const ids = r.buildsOn.map((n) => idOf.get(`${r.book}#${n}`));
                    const lost = r.buildsOn.filter((_, i) => ids[i] == null);
                    if (lost.length) { missing.push(`строка ${r.line}: в книге нет юнитов ${lost.join(', ')}`); continue; }
                    await tx.update(units).set({ buildsOn: ids as number[] }).where(
                        r.number != null
                            ? and(eq(units.book, r.book), eq(units.number, r.number))
                            : eq(units.position, r.position),
                    );
                }
                if (missing.length) throw new Error(`builds_on:\n${missing.join('\n')}`);
            }
            return done;
        });

        const added = result.filter((r) => r.inserted).length;
        console.log(`${rows.length} юнитов — новых ${added}, обновлено ${rows.length - added}`);
    } finally {
        await client.end();
    }
}

main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
});
