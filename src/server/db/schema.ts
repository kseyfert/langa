import { sql } from 'drizzle-orm';
import { bigint, boolean, index, integer, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core';

// Поля и правила — specs/catalog-spec.md §3. Триггер updated_at и RLS
// дописаны в миграцию руками: drizzle-kit их не генерирует.
export const units = pgTable(
    'units',
    {
        // mode: 'number' — 145 юнитов не дорастут до 2^53, а bigint не сериализуется в JSON.
        id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
        book: text('book').notNull(),
        section: text('section').notNull(),
        number: integer('number'),
        position: integer('position').notNull().unique(),
        title: text('title').notNull(),
        summaryRu: text('summary_ru').notNull().default(''),
        guide: text('guide').notNull().default(''),
        buildsOn: bigint('builds_on', { mode: 'number' }).array().notNull().default(sql`'{}'`),
        reviewed: boolean('reviewed').notNull().default(false),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [unique().on(t.book, t.number), index('units_book_idx').on(t.book)],
);
