'use client';

import { useEffect, useId, useRef, useState, useTransition, type MouseEvent } from 'react';
import { Icon } from '@/components/Icon';
import { GapExercise } from '@/components/exercises/GapExercise';
import type { ExerciseView } from '@/server/tasks';
import { startGap } from '@/app/actions';

const FLASH = 'catalog__unit--flash';

/**
 * Подсветка классом, а не :target: :target не срабатывает повторно, если
 * ссылка ведёт туда же, куда и прошлая, — а на один юнит ссылаются многие.
 */
function flash(el: HTMLElement) {
    el.classList.remove(FLASH);
    void el.offsetWidth; // перезапуск анимации, если строка уже мигала
    el.classList.add(FLASH);
    el.addEventListener('animationend', () => el.classList.remove(FLASH), { once: true });
}

/** Переход к юниту на этой же странице; прокрутка плавная за счёт scroll-behavior в base.css. */
function jump(e: MouseEvent<HTMLAnchorElement>, href: string) {
    if (!href.startsWith('#')) return;
    const el = document.getElementById(href.slice(1));
    if (!el) return;
    e.preventDefault();
    history.pushState(null, '', href);
    el.scrollIntoView({ block: 'start' });
    flash(el);
}

/** Юнит из builds_on: title и href — null, если такого id в базе нет. */
export type Dep = { id: number; title: string | null; href: string | null };

type Props = {
    id: number;
    number: number | null;
    title: string;
    summaryRu: string;
    /** guide, уже отрендеренный на сервере; null — описания нет. */
    guideHtml: string | null;
    deps: Dep[];
};

export function UnitRow({ id: unitId, number, title, summaryRu, guideHtml, deps }: Props) {
    const [open, setOpen] = useState(false);
    const id = useId();
    const row = useRef<HTMLLIElement>(null);
    const [exercise, setExercise] = useState<ExerciseView | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, startLoading] = useTransition();

    const play = () =>
        startLoading(async () => {
            setError(null);
            const res = await startGap(unitId);
            if (res.ok) setExercise(res.exercise);
            else setError(res.error);
        });

    // Пришли по ссылке с другой страницы (из выдачи поиска): браузер уже
    // прокрутил к якорю, осталось подсветить.
    useEffect(() => {
        if (row.current && location.hash === `#unit-${unitId}`) flash(row.current);
    }, [unitId]);
    return (
        <li ref={row} id={`unit-${unitId}`} className={`catalog__unit${open ? ' catalog__unit--open' : ''}`}>
            {/* Переключает только шапка: клик по тексту guide не должен сворачивать — его выделяют и копируют. */}
            <button
                type="button"
                className="catalog__head"
                aria-expanded={open}
                aria-controls={id}
                onClick={() => setOpen((v) => !v)}
            >
                <span className="catalog__num mono">{number ?? '—'}</span>
                <span>
                    <span className="catalog__title">{title}</span>
                    {summaryRu && <span className="catalog__summary hint muted">{summaryRu}</span>}
                </span>
            </button>
            {/* Отдельно от шапки: кнопка в кнопке недопустима, и запуск задания не должен раскрывать guide. */}
            <span className="catalog__play">
                {loading ? (
                    <span className="icon-btn" role="status" aria-label="Составляю задание…"><span className="spinner" /></span>
                ) : (
                    <button type="button" className="icon-btn" title="Задание на пропуски" aria-label="Задание на пропуски" onClick={play}>
                        <Icon name="play" />
                    </button>
                )}
            </span>
            <div className="catalog__more" id={id} inert={!open}>
                <div className="catalog__more-inner">
                    {deps.length > 0 && (
                        <p className="catalog__deps">
                            <span className="muted" aria-label="Опирается на">→</span>{' '}
                            {deps.map((d, i) => (
                                <span key={d.id}>
                                    {i > 0 && ' · '}
                                    {d.href ? (
                                        <a className="linklike" href={d.href} onClick={(e) => jump(e, d.href!)}>
                                            {d.title}
                                        </a>
                                    ) : (
                                        <span className="mono muted">{d.id}</span>
                                    )}
                                </span>
                            ))}
                        </p>
                    )}
                    {guideHtml ? (
                        // guide пишет сам пользователь, чужого HTML там нет.
                        <div className="guide" dangerouslySetInnerHTML={{ __html: guideHtml }} />
                    ) : (
                        <p className="hint muted">Описания пока нет</p>
                    )}
                </div>
            </div>
            {(exercise || error) && (
                <div className="catalog__task">
                    {error && <p className="error">{error}</p>}
                    {exercise?.type === 'gap' && (
                        <>
                            <button type="button" className="icon-btn catalog__task-close" title="Закрыть задание"
                                aria-label="Закрыть задание" onClick={() => setExercise(null)}>
                                <Icon name="cancel" />
                            </button>
                            <GapExercise key={exercise.id} exerciseId={exercise.id} content={exercise.content} />
                        </>
                    )}
                </div>
            )}
        </li>
    );
}
