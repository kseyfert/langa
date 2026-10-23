import type { SessionUnit, Snapshot, TaskOutcome } from '@/server/learner';

const OUTCOME: Record<TaskOutcome, string> = { ok: 'верно', bad: 'с ошибками', skip: 'пропущено', open: 'не закончено' };

const num = (n: number) => String(n).padStart(2, '0');

/** «было → стало»; стало — цветом направления: вверх «доведено», вниз брак. */
function Change({ before, after, pick, unit }: {
    before: Snapshot | null; after: Snapshot | null; pick: (s: Snapshot) => number; unit?: string;
}) {
    const a = before && pick(before);
    const b = after && pick(after);
    const dir = a == null || b == null || a === b ? '' : b > a ? ' summary__to--up' : ' summary__to--down';
    return (
        <td className="summary__num mono">
            <span className="muted">{a ?? '—'} → </span>
            <span className={`summary__to${dir}`}>{b ?? '—'}</span>
            {unit && <small className="muted">{unit}</small>}
        </td>
    );
}

/** Итог сессии: юниты, у которых сдвинулись рейтинг, освоение или «держится», и насколько. */
export function SessionSummary({ count, units }: { count: number; units: (SessionUnit & { name: string })[] }) {
    return (
        <div className="summary">
            <p className="summary__title">Сессия окончена</p>
            <p className="summary__meta muted mono">заданий {count} · юнитов {units.length}</p>
            {units.length === 0 ? (
                <p className="hint muted">Рейтинг ни одного юнита не изменился.</p>
            ) : (
                <table className="summary__table">
                    <thead>
                        <tr><th>Юнит</th><th>Рейтинг</th><th>Освоение</th><th>Держится</th></tr>
                    </thead>
                    <tbody>
                        {units.map((u) => (
                            <tr key={u.unitId}>
                                <td>
                                    <span className="summary__unit">{u.name}</span>
                                    <span className="summary__tasks muted">
                                        {[
                                            ...u.tasks.map((t) => <span key={t.n}><span className="mono">{num(t.n)}</span> {t.type} — {OUTCOME[t.outcome]}</span>),
                                            ...(u.sideIn.length ? [<span key="side">побочно в <span className="mono">{u.sideIn.map(num).join(', ')}</span></span>] : []),
                                        ].flatMap((el, i) => (i ? [' · ', el] : [el]))}
                                    </span>
                                </td>
                                <Change before={u.before} after={u.after} pick={(s) => Math.round(s.progress)} />
                                <Change before={u.before} after={u.after} pick={(s) => Math.round(s.mastery)} />
                                <Change before={u.before} after={u.after} pick={(s) => s.intervalDays} unit="дн" />
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
}
