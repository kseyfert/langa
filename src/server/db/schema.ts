import { sql } from 'drizzle-orm';
import { bigint, boolean, check, index, integer, jsonb, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core';
import {
    EXERCISE_TYPES, VERDICTS,
    type Answer, type Evaluation, type ExerciseContent, type ExerciseType, type Verdict,
} from '../exercises/types';

/** check по списку значений: text + check, а не pg enum — новое значение добавляется простой миграцией. */
const oneOf = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));

// Рабочая область — владелец юнитов и граница их уникальности (specs/catalog-spec.md §3).
// Триггер updated_at и RLS дописаны в миграцию руками.
export const workspaces = pgTable('workspaces', {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    // Имя папки content/<key>/ с промптами, evals и настройками области; в коде области — по нему.
    key: text('key').notNull().unique(),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Поля и правила — specs/catalog-spec.md §3. Триггер updated_at и RLS
// дописаны в миграцию руками: drizzle-kit их не генерирует.
export const units = pgTable(
    'units',
    {
        // mode: 'number' — 145 юнитов не дорастут до 2^53, а bigint не сериализуется в JSON.
        id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
        workspaceId: bigint('workspace_id', { mode: 'number' }).notNull().references(() => workspaces.id, { onDelete: 'restrict' }),
        book: text('book').notNull(),
        section: text('section').notNull(),
        number: integer('number'),
        position: integer('position').notNull(),
        title: text('title').notNull(),
        summaryRu: text('summary_ru').notNull().default(''),
        guide: text('guide').notNull().default(''),
        buildsOn: bigint('builds_on', { mode: 'number' }).array().notNull().default(sql`'{}'`),
        reviewed: boolean('reviewed').notNull().default(false),
        // Взят ли юнит в работу.
        started: boolean('started').notNull().default(false),
        // Не предлагать проверке как побочный: юнит-обобщение, его ошибки должны лечь на частные юниты.
        excludeAsSide: boolean('exclude_as_side').notNull().default(false),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
        unique('units_workspace_position_unique').on(t.workspaceId, t.position),
        unique('units_workspace_book_number_unique').on(t.workspaceId, t.book, t.number),
        index('units_workspace_book_idx').on(t.workspaceId, t.book),
    ],
);

// Поля и правила — specs/exercise-spec.md §5. RLS дописан в миграцию руками.
// Форму jsonb по типу база не проверяет — это делает валидация перед записью.
export const exercises = pgTable(
    'exercises',
    {
        id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
        unitId: bigint('unit_id', { mode: 'number' }).notNull().references(() => units.id, { onDelete: 'restrict' }),
        type: text('type').$type<ExerciseType>().notNull(),
        content: jsonb('content').$type<ExerciseContent>().notNull(),
        topic: text('topic').notNull(),
        model: text('model').notNull(),
        promptVersion: text('prompt_version').notNull(),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
        index('exercises_unit_created_idx').on(t.unitId, t.createdAt),
        check('exercises_type_check', sql`${t.type} in (${oneOf(EXERCISE_TYPES)})`),
    ],
);

export const exerciseAttempts = pgTable(
    'exercise_attempts',
    {
        id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
        exerciseId: bigint('exercise_id', { mode: 'number' }).notNull().references(() => exercises.id, { onDelete: 'restrict' }),
        seq: integer('seq').notNull(),
        answer: jsonb('answer').$type<Answer>().notNull(),
        evaluation: jsonb('evaluation').$type<Evaluation>().notNull(),
        verdict: text('verdict').$type<Verdict>(),
        model: text('model'),
        promptVersion: text('prompt_version'),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
        unique().on(t.exerciseId, t.seq),
        check('exercise_attempts_verdict_check', sql`${t.verdict} in (${oneOf(VERDICTS)})`),
    ],
);
