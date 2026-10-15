import type { ClosedEvaluation } from '@/server/exercises/types';

/** Низ закрытого задания: до проверки — ошибка и кнопка, после — итог. */
export function CheckActions({ result, error, busy }: { result: ClosedEvaluation | undefined; error: string | null; busy: boolean }) {
    return (
        <div className="exercise__actions row">
            {result ? (
                <p className={`exercise__score mono${result.correct === result.total ? ' exercise__score--done' : ''}`}>
                    Верно {result.correct} из {result.total}
                </p>
            ) : (
                <>
                    {error && <p className="error">{error}</p>}
                    <button type="submit" className="btn btn--primary exercise__check" disabled={busy}>
                        {busy ? 'Проверяю…' : 'Проверить'}
                    </button>
                </>
            )}
        </div>
    );
}
