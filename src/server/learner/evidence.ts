import { isOpenEvaluation, type Evaluation, type ExerciseType } from '../exercises/types';
import { targetResult, type Evidence } from './model';

/** Попытка из лога — всё, что нужно для свидетельств. */
export type LoggedAttempt = { at: number; unitId: number; type: ExerciseType; evaluation: Evaluation };

/**
 * Свидетельства одной попытки — specs/rating-model.md §3.1. Каждая попытка
 * сама по себе: статус задания и предыдущие попытки не учитываются.
 */
export function evidenceOf(a: LoggedAttempt): { unitId: number; ev: Evidence }[] {
    const out: { unitId: number; ev: Evidence }[] = [];
    const push = (unitId: number, role: Evidence['role'], r: number) =>
        out.push({ unitId, ev: { at: a.at, role, type: a.type, r } });

    const e = a.evaluation;
    if (!isOpenEvaluation(e)) {
        const r = targetResult({ kind: 'share', correct: e.correct, total: e.total });
        if (r != null) push(a.unitId, 'target', r);
        return out;
    }

    // «Верно, но без целевой конструкции» по целевому юниту свидетельства не даёт.
    if (e.verdict !== 'correct_non_target') {
        const r = e.target.status === 'not_used'
            ? targetResult({ kind: 'not_used' })
            : targetResult({ kind: 'used', score: e.target.score ?? (e.target.status === 'correct' ? 100 : 0) });
        if (r != null) push(a.unitId, 'target', r);
    }

    // Побочные: ошибки и «частично» всегда, верные — только отмеченные notable.
    for (const o of e.others) {
        if (o.unit_id === a.unitId) continue;
        if (o.status === 'error' || o.status === 'partial') push(o.unit_id, 'side', o.score != null ? o.score / 100 : 0.3);
        else if (o.notable) push(o.unit_id, 'side', o.score != null ? o.score / 100 : 1);
    }
    return out;
}
