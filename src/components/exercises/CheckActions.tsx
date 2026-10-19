import type { ClosedEvaluation } from '@/server/exercises/types';
import { ExerciseActions, useActionsSlotted } from './ExerciseActions';

/** Низ закрытого задания: до проверки — ошибка и кнопка, после — итог. */
export function CheckActions({ formId, result, error, busy }: { formId: string; result: ClosedEvaluation | undefined; error: string | null; busy: boolean }) {
    const slotted = useActionsSlotted();
    if (result && slotted) return null;
    return (
        <ExerciseActions>
            {result ? (
                <p className={`exercise__score mono${result.correct === result.total ? ' exercise__score--done' : ''}`}>
                    Верно {result.correct} из {result.total}
                </p>
            ) : (
                <>
                    {error && <p className="error">{error}</p>}
                    <button type="submit" form={formId} className="btn btn--primary exercise__check" disabled={busy}>
                        {busy ? 'Проверяю…' : 'Проверить'}
                    </button>
                </>
            )}
        </ExerciseActions>
    );
}
