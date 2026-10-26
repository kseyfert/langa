import { isOpenEvaluation, type Evaluation, type ExerciseType } from '../exercises/types';
import { targetResult, type Config, type Evidence } from './model';

/** Попытка из лога — всё, что нужно для свидетельств. */
export type LoggedAttempt = { at: number; unitId: number; type: ExerciseType; evaluation: Evaluation };

/**
 * Свидетельства одной попытки — specs/rating-model.md §3.1. Каждая попытка
 * сама по себе: статус задания и предыдущие попытки не учитываются.
 * isStarted — текущая отметка «в работе»: побочные свидетельства бывают только у начатых юнитов.
 * c — конфиг области юнита попытки: побочные юниты из той же области (каталог проверки — её книга).
 */
export function evidenceOf(a: LoggedAttempt, isStarted: (unitId: number) => boolean, c: Config): { unitId: number; ev: Evidence }[] {
    const out: { unitId: number; ev: Evidence }[] = [];
    const push = (unitId: number, role: Evidence['role'], r: number) =>
        out.push({ unitId, ev: { at: a.at, role, type: a.type, r } });

    const e = a.evaluation;
    if (!isOpenEvaluation(e)) {
        const r = targetResult({ kind: 'share', correct: e.correct, total: e.total }, c);
        if (r != null) push(a.unitId, 'target', r);
        return out;
    }

    // «Верно, но без целевой конструкции» по целевому юниту свидетельства не даёт.
    if (e.verdict !== 'correct_non_target') {
        const r = e.target.status === 'not_used'
            ? targetResult({ kind: 'not_used' }, c)
            : targetResult({ kind: 'used', score: e.target.score ?? (e.target.status === 'correct' ? 100 : 0) }, c);
        if (r != null) push(a.unitId, 'target', r);
    }

    // Побочные — только штраф (§3.4): ошибка или «частично» ниже порога провала у начатого юнита.
    // Удачные (и notable) и «частично» с высоким баллом юнит не улучшают — их не берём.
    for (const o of e.others) {
        if (o.unit_id === a.unitId || o.status === 'correct' || !isStarted(o.unit_id)) continue;
        const r = o.score != null ? o.score / 100 : 0.3;
        if (r < c.FAIL_THRESHOLD) push(o.unit_id, 'side', r);
    }
    return out;
}
