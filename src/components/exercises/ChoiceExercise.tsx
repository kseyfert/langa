'use client';

import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Icon } from '@/components/Icon';
import type { PublicContentByType } from '@/server/exercises/types';
import { CheckActions } from './CheckActions';
import { useClosedCheck } from './useClosedCheck';
import './Exercise.css';
import './ChoiceExercise.css';

/** Выбор варианта: варианты — переключателем под предложением, выбранный встаёт в пропуск. */
export function ChoiceExercise({ exerciseId, content, onDone }: { exerciseId: number; content: PublicContentByType['choice']; onDone?: (ok: boolean) => void }) {
    const [picked, setPicked] = useState<(number | null)[]>(() => content.items.map(() => null));
    const { checked, error, busy, submit } = useClosedCheck(exerciseId, 'choice', onDone);
    const formId = useId();

    const form = useRef<HTMLFormElement>(null);

    const onSubmit = (e: FormEvent) => {
        e.preventDefault();
        submit(picked);
    };

    const groups = () => form.current?.querySelectorAll<HTMLElement>('.pick__opts') ?? [];
    // Сразу можно отвечать с клавиатуры; прокрутку не трогаем — задание и так на виду.
    useEffect(() => groups()[0]?.focus({ preventScroll: true }), []);

    // Цифра — выбрать вариант и перейти к следующему предложению, Enter — просто
    // перейти, Cmd/Ctrl+Enter — проверить.
    const onKeyDown = (e: KeyboardEvent<HTMLElement>, i: number) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            return form.current?.requestSubmit();
        }
        if (checked || e.metaKey || e.ctrlKey || e.altKey) return;
        const j = Number(e.key) - 1;
        const pick = /^[1-9]$/.test(e.key) && j < content.items[i].options.length;
        if (!pick && e.key !== 'Enter') return;
        e.preventDefault();
        if (pick) setPicked((v) => v.map((x, k) => (k === i ? j : x)));
        groups()[i + 1]?.focus();
    };

    const result = checked?.evaluation;
    return (
        <form ref={form} id={formId} className="exercise" onSubmit={onSubmit}>
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
                                <div className="choice pick__opts" role="radiogroup" aria-label={`Пункт ${i + 1}`}
                                    tabIndex={0} onKeyDown={(e) => onKeyDown(e, i)}>
                                    {it.options.map((o, j) => {
                                        const mark = sol ? (j === sol.correct ? ' pick__opt--right' : j === p ? ' pick__opt--wrong' : '') : '';
                                        return (
                                            <button key={j} type="button" role="radio" aria-checked={p === j} disabled={!!checked}
                                                className={`choice__opt${p === j ? ' choice__opt--on' : ''}${mark}`}
                                                onClick={() => setPicked((v) => v.map((x, k) => (k === i ? j : x)))}>
                                                <span className="pick__key mono" aria-hidden="true">{j + 1}</span>{o}
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
            <CheckActions formId={formId} result={result} error={error} busy={busy} />
        </form>
    );
}
