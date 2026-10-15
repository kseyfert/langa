'use client';

import { useEffect, useId, useRef, useState, useTransition } from 'react';
import { Icon } from '@/components/Icon';
import { ChoiceExercise } from '@/components/exercises/ChoiceExercise';
import { GapExercise } from '@/components/exercises/GapExercise';
import { RephraseExercise } from '@/components/exercises/RephraseExercise';
import { flash, jump } from '@/components/jump';
import { MeterHold, MeterSpark } from '@/components/UnitMeter';
import type { UnitRating } from '@/server/learner';
import type { ExerciseView } from '@/server/tasks';
import { startExercise } from '@/app/actions';
import { READY_TYPES } from '@/server/tasks/types';

// Выбор типа задания — временно, на время тестов. Общий для всех строк:
// запоминается в браузере, чтобы не выбирать заново в каждом юните.
const TYPE_KEY = 'langa:exercise-type';
const readType = () => {
    try { return localStorage.getItem(TYPE_KEY) ?? ''; } catch { return ''; }
};
const saveType = (t: string) => {
    try { localStorage.setItem(TYPE_KEY, t); } catch { /* без памяти — не страшно */ }
};

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
    /** null — по юниту ещё не было практики. */
    rating: UnitRating | null;
};

export function UnitRow({ id: unitId, number, title, summaryRu, guideHtml, deps, rating }: Props) {
    const [open, setOpen] = useState(false);
    const id = useId();
    const row = useRef<HTMLLIElement>(null);
    const [exercise, setExercise] = useState<ExerciseView | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, startLoading] = useTransition();

    const [type, setType] = useState('');
    const toggle = () => setOpen((v) => !v);

    const play = () =>
        startLoading(async () => {
            setError(null);
            const res = await startExercise(unitId, readType() || null);
            if (res.ok) setExercise(res.exercise);
            else setError(res.error);
        });

    // Пришли по ссылке с другой страницы (из выдачи поиска): браузер уже
    // прокрутил к якорю, осталось подсветить.
    // Из localStorage — после монтирования: на сервере его нет, иначе разойдётся гидратация.
    useEffect(() => setType(readType()), []);

    useEffect(() => {
        if (row.current && location.hash === `#unit-${unitId}`) flash(row.current);
    }, [unitId]);
    return (
        <li ref={row} id={`unit-${unitId}`} className={`catalog__unit${open ? ' catalog__unit--open' : ''}`}>
            {/* Шапка — не одна кнопка: внутри неё ▶, а кнопку в кнопку вкладывать нельзя.
                Раскрывает guide кнопка-название (и с клавиатуры); номер и описание — щелчком мыши.
                Клик по тексту guide не сворачивает: его выделяют и копируют. */}
            <span className="catalog__num mono" onClick={toggle}>{number ?? '—'}</span>
            <span className="catalog__titleline">
                <button type="button" className="catalog__title" aria-expanded={open} aria-controls={id} onClick={toggle}>
                    {title}
                </button>
                {loading ? (
                    <span className="icon-btn catalog__play" role="status" aria-label="Составляю задание…"><span className="spinner" /></span>
                ) : (
                    <button type="button" className="icon-btn catalog__play" title="Задание" aria-label="Задание" onClick={play}>
                        <Icon name="play" />
                    </button>
                )}
                <select className="catalog__type" aria-label="Тип задания" title="Тип задания" value={type}
                    onFocus={() => setType(readType())}
                    onChange={(e) => { setType(e.target.value); saveType(e.target.value); }}>
                    <option value="">любой</option>
                    {READY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
            </span>
            {summaryRu && <span className="catalog__summary hint muted" onClick={toggle}>{summaryRu}</span>}
            {rating && (
                <>
                    <MeterSpark rating={rating} className="catalog__spark" />
                    <MeterHold rating={rating} className="catalog__hold" />
                </>
            )}
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
                    {exercise && (
                        <>
                            <button type="button" className="icon-btn catalog__task-close" title="Закрыть задание"
                                aria-label="Закрыть задание" onClick={() => setExercise(null)}>
                                <Icon name="cancel" />
                            </button>
                            {exercise.type === 'gap' && <GapExercise key={exercise.id} exerciseId={exercise.id} content={exercise.content} />}
                            {exercise.type === 'choice' && <ChoiceExercise key={exercise.id} exerciseId={exercise.id} content={exercise.content} />}
                            {exercise.type === 'rephrase' && <RephraseExercise key={exercise.id} exerciseId={exercise.id} content={exercise.content} targetName={`${number ?? '—'}. ${title}`} />}
                        </>
                    )}
                </div>
            )}
        </li>
    );
}
