import 'server-only';
import { asc, desc, eq, max } from 'drizzle-orm';
import { db } from '../db/client';
import { exerciseAttempts, exercises } from '../db/schema';
import {
    isClosed, isOpenEvaluation,
    type Answer, type Attempt, type ContentByType, type Evaluation, type Exercise, type ExerciseStatus,
    type ExerciseType, type ExerciseWithAttempts, type PublicContentByType, type Verdict,
} from './types';

export * from './types';

type ExerciseRow = typeof exercises.$inferSelect;
type AttemptRow = typeof exerciseAttempts.$inferSelect;

const iso = (d: Date | null) => (d ? d.toISOString() : null);

function toExercise(r: ExerciseRow): Exercise {
    // Пару type ↔ content гарантирует валидация при записи, а не база.
    return { ...r, createdAt: r.createdAt.toISOString(), finishedAt: iso(r.finishedAt) } as Exercise;
}

function toAttempt(r: AttemptRow): Attempt {
    return { ...r, createdAt: r.createdAt.toISOString() };
}

export async function createExercise<T extends ExerciseType>(input: {
    unitId: number;
    type: T;
    content: ContentByType[T];
    topic: string;
    model: string;
    promptVersion: string;
}): Promise<Exercise> {
    const [row] = await db().insert(exercises).values(input).returning();
    return toExercise(row);
}

export async function getExercise(id: number): Promise<ExerciseWithAttempts> {
    const [row] = await db().select().from(exercises).where(eq(exercises.id, id));
    if (!row) throw new Error(`Задание ${id} не найдено`);
    const attempts = await db()
        .select()
        .from(exerciseAttempts)
        .where(eq(exerciseAttempts.exerciseId, id))
        .orderBy(asc(exerciseAttempts.seq));
    return { ...toExercise(row), attempts: attempts.map(toAttempt) };
}

export async function listExercises({ unitId, limit = 50 }: { unitId?: number; limit?: number } = {}): Promise<Exercise[]> {
    const rows = await db()
        .select()
        .from(exercises)
        .where(unitId != null ? eq(exercises.unitId, unitId) : undefined)
        .orderBy(desc(exercises.createdAt))
        .limit(limit);
    return rows.map(toExercise);
}

/** Содержимое для клиента до проверки: без ключей ответов, эталонов и объяснений. */
export function publicContent(ex: Exercise): PublicContentByType[ExerciseType] {
    switch (ex.type) {
        case 'gap': {
            const { instructions_ru, items } = ex.content;
            return { instructions_ru, items: items.map(({ text }) => ({ text })) };
        }
        case 'choice': {
            const { instructions_ru, items } = ex.content;
            return { instructions_ru, items: items.map(({ text, options }) => ({ text, options })) };
        }
        case 'translate': {
            const { target_note_ru, reference_en, ...rest } = ex.content;
            return rest;
        }
        case 'rephrase':
        case 'free': {
            const { reference_en, ...rest } = ex.content;
            return rest;
        }
    }
}

/** Статус и балл задания по оценке последней попытки — specs/exercise-spec.md §5.1, §6. */
function outcome(evaluation: Evaluation): { status: ExerciseStatus | null; targetScore: number | null } {
    if (!isOpenEvaluation(evaluation)) {
        const { correct, total } = evaluation;
        return {
            status: correct === total ? 'accepted' : 'failed',
            targetScore: total ? Math.round((correct / total) * 100) : null,
        };
    }
    const status = { correct_target: 'accepted', incorrect: 'failed', correct_non_target: null } as const;
    return { status: status[evaluation.verdict], targetScore: evaluation.target.score };
}

/**
 * Вердикт попытки для просмотра и фильтрации. У gap/choice — по пакету целиком;
 * рейтинг для них берёт долю верных из evaluation, а не это поле.
 */
function verdictOf(evaluation: Evaluation): Verdict {
    if (isOpenEvaluation(evaluation)) return evaluation.verdict;
    return evaluation.correct === evaluation.total ? 'correct_target' : 'incorrect';
}

/**
 * Записывает попытку и пересчитывает статус задания — в одной транзакции,
 * со строкой задания под блокировкой, чтобы две попытки не взяли один seq.
 */
export async function addAttempt(
    exerciseId: number,
    input: { answer: Answer; evaluation: Evaluation; model: string | null; promptVersion: string | null },
): Promise<Attempt> {
    return db().transaction(async (tx) => {
        const [ex] = await tx.select().from(exercises).where(eq(exercises.id, exerciseId)).for('update');
        if (!ex) throw new Error(`Задание ${exerciseId} не найдено`);
        if (ex.status) throw new Error(`Задание ${exerciseId} уже завершено`);
        if (isClosed(ex.type) === isOpenEvaluation(input.evaluation)) {
            throw new Error(`Оценка не подходит к типу задания ${ex.type}`);
        }

        const [{ last }] = await tx
            .select({ last: max(exerciseAttempts.seq) })
            .from(exerciseAttempts)
            .where(eq(exerciseAttempts.exerciseId, exerciseId));
        // Отдельной проверки «у gap/choice одна попытка» не нужно: их оценка
        // всегда даёт статус, а в завершённое задание попытка не пишется.
        const seq = (last ?? 0) + 1;

        const [row] = await tx
            .insert(exerciseAttempts)
            .values({
                exerciseId,
                seq,
                ...input,
                verdict: verdictOf(input.evaluation),
            })
            .returning();

        const { status, targetScore } = outcome(input.evaluation);
        await tx
            .update(exercises)
            .set({ status, targetScore, finishedAt: status ? row.createdAt : null })
            .where(eq(exercises.id, exerciseId));

        return toAttempt(row);
    });
}
