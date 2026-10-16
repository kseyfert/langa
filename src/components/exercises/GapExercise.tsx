'use client';

import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { Icon } from '@/components/Icon';
import type { PublicContentByType } from '@/server/exercises/types';
import { CheckActions } from './CheckActions';
import { useClosedCheck } from './useClosedCheck';
import './Exercise.css';
import './GapExercise.css';

/** Задание на пропуски: предложение с полем на месте ___, проверка — один раз. */
export function GapExercise({ exerciseId, content }: { exerciseId: number; content: PublicContentByType['gap'] }) {
    const [values, setValues] = useState(() => content.items.map(() => ''));
    const { checked, error, busy, submit } = useClosedCheck(exerciseId, 'gap');

    const onSubmit = (e: FormEvent) => {
        e.preventDefault();
        submit(values);
    };

    // Enter — к следующему пропуску (на последнем — ничего), Cmd/Ctrl+Enter — проверить.
    // Без перехвата Enter в поле отправлял бы форму сразу.
    const onKeyDown = (e: KeyboardEvent<HTMLInputElement>, i: number) => {
        if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
        e.preventDefault();
        const form = e.currentTarget.form;
        if (e.metaKey || e.ctrlKey) form?.requestSubmit();
        else form?.querySelectorAll<HTMLInputElement>('.gap__input')[i + 1]?.focus();
    };

    const result = checked?.evaluation;
    return (
        <form className="exercise" onSubmit={onSubmit}>
            {content.instructions_ru && <p className="exercise__instructions">{content.instructions_ru}</p>}
            <ol className="exercise__items">
                {content.items.map((it, i) => {
                    const [before, after] = it.text.split('___');
                    const res = result?.items[i];
                    const sol = checked?.solution.items[i];
                    return (
                        <li key={i} className={`exercise__item${res ? (res.correct ? ' exercise__item--ok' : ' exercise__item--bad') : ''}`}>
                            <span className="exercise__num mono">{String(i + 1).padStart(2, '0')}</span>
                            <div>
                                <span>
                                    {before}
                                    <input
                                        className="input gap__input"
                                        aria-label={`Пропуск ${i + 1}`}
                                        value={values[i]}
                                        // Поле растёт под ответ и сжимается обратно до минимума из CSS.
                                        style={{ width: `${values[i].length + 2}ch` }}
                                        readOnly={!!checked}
                                        onChange={(e) => setValues((v) => v.map((x, j) => (j === i ? e.target.value : x)))}
                                        onKeyDown={(e) => onKeyDown(e, i)}
                                        autoComplete="off" autoCapitalize="off" spellCheck={false}
                                    />
                                    {after}
                                    {res?.correct && <span className="exercise__mark" aria-label="Верно"><Icon name="ok" /></span>}
                                </span>
                                {res && sol && (
                                    <p className="exercise__note">
                                        {!res.correct && <span className="exercise__answer">{sol.answers.join(' / ')}</span>}
                                        {!res.correct && sol.explain_ru && ' — '}
                                        {sol.explain_ru && <span className="muted">{sol.explain_ru}</span>}
                                    </p>
                                )}
                            </div>
                        </li>
                    );
                })}
            </ol>
            <CheckActions result={result} error={error} busy={busy} />
        </form>
    );
}
