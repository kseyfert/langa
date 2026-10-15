'use client';

import { useState, type FormEvent } from 'react';
import { Icon } from '@/components/Icon';
import type { PublicContentByType } from '@/server/exercises/types';
import { CheckActions } from './CheckActions';
import { useClosedCheck } from './useClosedCheck';
import './Exercise.css';
import './ChoiceExercise.css';

/** Выбор варианта: варианты — переключателем под предложением, выбранный встаёт в пропуск. */
export function ChoiceExercise({ exerciseId, content }: { exerciseId: number; content: PublicContentByType['choice'] }) {
    const [picked, setPicked] = useState<(number | null)[]>(() => content.items.map(() => null));
    const { checked, error, busy, submit } = useClosedCheck(exerciseId, 'choice');

    const onSubmit = (e: FormEvent) => {
        e.preventDefault();
        submit(picked);
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
                    const p = picked[i];
                    return (
                        <li key={i} className={`exercise__item${res ? (res.correct ? ' exercise__item--ok' : ' exercise__item--bad') : ''}`}>
                            <span className="exercise__num mono">{String(i + 1).padStart(2, '0')}</span>
                            <div>
                                <span>
                                    {before}
                                    <span className={`pick__blank${p === null ? ' pick__blank--empty' : ''}`}>
                                        {p === null ? '___' : it.options[p]}
                                    </span>
                                    {after}
                                    {res?.correct && <span className="exercise__mark" aria-label="Верно"><Icon name="ok" /></span>}
                                </span>
                                <div className="choice pick__opts" role="radiogroup" aria-label={`Пункт ${i + 1}`}>
                                    {it.options.map((o, j) => {
                                        const mark = sol ? (j === sol.correct ? ' pick__opt--right' : j === p ? ' pick__opt--wrong' : '') : '';
                                        return (
                                            <button key={j} type="button" role="radio" aria-checked={p === j} disabled={!!checked}
                                                className={`choice__opt${p === j ? ' choice__opt--on' : ''}${mark}`}
                                                onClick={() => setPicked((v) => v.map((x, k) => (k === i ? j : x)))}>
                                                {o}
                                            </button>
                                        );
                                    })}
                                </div>
                                {sol?.explain_ru && <p className="exercise__note muted">{sol.explain_ru}</p>}
                            </div>
                        </li>
                    );
                })}
            </ol>
            <CheckActions result={result} error={error} busy={busy} />
        </form>
    );
}
