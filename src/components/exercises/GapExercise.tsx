'use client';

import { useState, useTransition, type FormEvent } from 'react';
import { checkExercise } from '@/app/actions';
import { Icon } from '@/components/Icon';
import type { ClosedEvaluation, GapContent, PublicContentByType } from '@/server/exercises/types';
import './GapExercise.css';

type Checked = { evaluation: ClosedEvaluation; solution: GapContent };

/** Задание на пропуски: предложение с полем на месте ___, проверка — один раз. */
export function GapExercise({ exerciseId, content }: { exerciseId: number; content: PublicContentByType['gap'] }) {
    const [values, setValues] = useState(() => content.items.map(() => ''));
    const [checked, setChecked] = useState<Checked | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, startBusy] = useTransition();

    const submit = (e: FormEvent) => {
        e.preventDefault();
        if (checked || busy) return;
        startBusy(async () => {
            setError(null);
            const res = await checkExercise(exerciseId, values);
            if (!res.ok) return setError(res.error);
            if (res.solution?.type !== 'gap' || 'verdict' in res.attempt.evaluation) {
                return setError('Сервер вернул проверку не того вида');
            }
            setChecked({ evaluation: res.attempt.evaluation, solution: res.solution.content });
        });
    };

    const result = checked?.evaluation;
    return (
        <form className="gap" onSubmit={submit}>
            {content.instructions_ru && <p className="gap__instructions">{content.instructions_ru}</p>}
            <ol className="gap__items">
                {content.items.map((it, i) => {
                    const [before, after] = it.text.split('___');
                    const res = result?.items[i];
                    const sol = checked?.solution.items[i];
                    return (
                        <li key={i} className={`gap__item${res ? (res.correct ? ' gap__item--ok' : ' gap__item--bad') : ''}`}>
                            <span className="gap__num mono">{String(i + 1).padStart(2, '0')}</span>
                            <div>
                                <span>
                                    {before}
                                    <input
                                        className="input gap__input"
                                        aria-label={`Пропуск ${i + 1}`}
                                        value={values[i]}
                                        readOnly={!!checked}
                                        onChange={(e) => setValues((v) => v.map((x, j) => (j === i ? e.target.value : x)))}
                                        autoComplete="off" autoCapitalize="off" spellCheck={false}
                                    />
                                    {after}
                                    {res?.correct && <span className="gap__mark" aria-label="Верно"><Icon name="ok" /></span>}
                                </span>
                                {res && sol && (
                                    <p className="gap__note">
                                        {!res.correct && <span className="gap__answer">{sol.answers.join(' / ')}</span>}
                                        {!res.correct && sol.explain_ru && ' — '}
                                        {sol.explain_ru && <span className="muted">{sol.explain_ru}</span>}
                                    </p>
                                )}
                            </div>
                        </li>
                    );
                })}
            </ol>
            <div className="gap__actions row">
                {result ? (
                    <p className={`gap__score mono${result.correct === result.total ? ' gap__score--done' : ''}`}>
                        Верно {result.correct} из {result.total}
                    </p>
                ) : (
                    error && <p className="error">{error}</p>
                )}
                {!checked && (
                    <button type="submit" className="btn btn--primary gap__check" disabled={busy}>
                        {busy ? 'Проверяю…' : 'Проверить'}
                    </button>
                )}
            </div>
        </form>
    );
}
