'use client';

import { useEffect, useRef, useState, useTransition, type CSSProperties, type ReactNode } from 'react';
import { AnyExercise } from '@/components/exercises/AnyExercise';
import { ActionsSlot } from '@/components/exercises/ExerciseActions';
import type { ExerciseView } from '@/server/tasks';
import { nextSessionExercise } from '@/app/actions';
import { PLANNER_CONFIG } from '@/server/learner/planner';
import './SessionPlayer.css';

const TIMES = PLANNER_CONFIG.SESSION_OPTIONS;
const DEFAULT_MIN = 15;

// Длительность запоминается в браузере — удобство, а не данные.
const MIN_KEY = 'langa:session-min';
const readMin = () => {
    try { const m = Number(localStorage.getItem(MIN_KEY)); return (TIMES as readonly number[]).includes(m) ? m : DEFAULT_MIN; } catch { return DEFAULT_MIN; }
};
const saveMin = (m: number) => {
    try { localStorage.setItem(MIN_KEY, String(m)); } catch { /* без памяти — не страшно */ }
};

type Current = { exercise: ExerciseView; targetName: string };
type Mark = 'ok' | 'bad' | 'skip';

/** Время без знака: просроченное видно по красному таймеру. */
function clock(sec: number) {
    const a = Math.abs(sec);
    return `${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`;
}

/**
 * Прокрутка, прижимающая плеер к верху окна. Своя, а не scroll-behavior:
 * та плавная для переходов по якорю и для смены задания слишком медленная.
 */
function pinToTop(el: HTMLElement) {
    // Кадр спустя: прошлое задание уже убрано, и если страница укоротилась, браузер успел поправить прокрутку.
    requestAnimationFrame(() => {
        const from = window.scrollY;
        const to = from + el.getBoundingClientRect().top;
        const go = (y: number) => window.scrollTo({ top: y, behavior: 'instant' });
        if (Math.abs(to - from) < 1 || matchMedia('(prefers-reduced-motion: reduce)').matches) return go(to);
        const t0 = performance.now();
        const step = (t: number) => {
            const p = Math.min(1, (t - t0) / 220);
            go(from + (to - from) * (1 - (1 - p) ** 3));
            if (p < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    });
}

const PLAY = <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4.5 2.4v11.2L13.2 8z" /></svg>;

/**
 * Плеер сессии: до старта — полоска с ▶ и длительностью, на старте рамка
 * раскрывается и задания идут одно за другим в ней. Время не обрывает задание: таймер
 * краснеет и считает дальше, а следующее задание после этого уже не берётся —
 * сессия заканчивается финальным экраном.
 */
export function SessionPlayer() {
    const [min, setMin] = useState(DEFAULT_MIN);
    const [endAt, setEndAt] = useState<number | null>(null);
    const [now, setNow] = useState(0);
    const [over, setOver] = useState(false);
    const [current, setCurrent] = useState<Current | null>(null);
    const [done, setDone] = useState<boolean | null>(null);
    const [marks, setMarks] = useState<Mark[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [loading, startLoading] = useTransition();
    const [open, setOpen] = useState(false);
    // Высота, с которой рамка едет при раскрытии/сворачивании; null — не едет.
    const [anim, setAnim] = useState<{ kind: 'open' | 'close'; from: number } | null>(null);
    const box = useRef<HTMLElement>(null);
    // Номер сессии: ответ, пришедший после «Завершить», к новой сессии не относится.
    const run = useRef(0);
    // Нижняя полоса, куда задание выносит свои кнопки; state, а не ref — чтобы задание перерисовалось, когда она появится.
    const [slot, setSlot] = useState<HTMLDivElement | null>(null);

    // Из localStorage — после монтирования: на сервере его нет, иначе разойдётся гидратация.
    useEffect(() => setMin(readMin()), []);

    const running = endAt != null;
    useEffect(() => {
        if (!running) return;
        setNow(Date.now());
        const t = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(t);
    }, [running]);

    const left = endAt == null ? 0 : Math.round((endAt - now) / 1000);

    // Сброс прошлого задания — до перехода, а не внутри него: обновления в
    // async-переходе применяются только по его окончании, и старая оценка висела бы всю загрузку.
    const clear = () => {
        setError(null);
        setCurrent(null);
        setDone(null);
    };

    const resize = (kind: 'open' | 'close') => {
        setAnim({ kind, from: box.current?.offsetHeight ?? 0 });
        setOpen(kind === 'open');
    };

    const fetchNext = () => {
        const id = run.current;
        startLoading(async () => {
            const res = await nextSessionExercise();
            if (id !== run.current) return;
            if (!res.ok) return setError(res.error);
            setCurrent({ exercise: res.exercise, targetName: res.targetName });
        });
    };

    /** Следующее задание — или конец сессии, если время уже вышло. */
    const advance = () => {
        clear();
        if (box.current) pinToTop(box.current);
        if (endAt != null && Date.now() > endAt) return setOver(true);
        fetchNext();
    };

    // Таймер идёт с первого задания, а не с нажатия: составление первого — не время сессии.
    // Нет заданий — рамка сворачивается обратно, и причина видна в полоске.
    const start = () => {
        const id = run.current;
        setError(null);
        setMarks([]);
        resize('open');
        if (box.current) pinToTop(box.current);
        startLoading(async () => {
            const res = await nextSessionExercise();
            if (id !== run.current) return;
            if (!res.ok) {
                resize('close');
                return setError(res.error);
            }
            setCurrent({ exercise: res.exercise, targetName: res.targetName });
            setEndAt(Date.now() + min * 60_000);
        });
    };

    const skip = () => {
        if (current && done == null) setMarks((m) => [...m, 'skip']);
        advance();
    };

    const onDone = (ok: boolean) => {
        setDone(ok);
        setMarks((m) => [...m, ok ? 'ok' : 'bad']);
    };

    const finish = () => {
        run.current++;
        resize('close');
        clear();
        setEndAt(null);
        setOver(false);
        setMarks([]);
    };

    const pick = (m: number) => {
        setMin(m);
        saveMin(m);
    };

    const frame = (cls: string, children: ReactNode) => (
        <section ref={box} aria-label="Сессия"
            className={`player ${cls}${anim ? ` player--${anim.kind === 'open' ? 'opening' : 'closing'}` : ''}`}
            style={anim ? ({ '--from': `${anim.from}px` } as CSSProperties) : undefined}
            onAnimationEnd={(e) => e.target === e.currentTarget && setAnim(null)}>
            {children}
        </section>
    );

    if (!open) {
        return frame('player--strip', <>
            <button type="button" className="player__play" aria-label={`Начать сессию на ${min} минут`} onClick={start} disabled={anim != null}>
                {PLAY}
            </button>
            <div className="seg" style={{ '--i': TIMES.indexOf(min as (typeof TIMES)[number]) } as CSSProperties}
                role="radiogroup" aria-label="Длительность сессии">
                <span className="seg__thumb" />
                {TIMES.map((t) => (
                    <button key={t} type="button" role="radio" aria-checked={t === min}
                        className={`seg__opt${t === min ? ' seg__opt--on' : ''}`} onClick={() => pick(t)}>
                        {t}<small>мин</small>
                    </button>
                ))}
            </div>
            {error && <p className="error player__error">{error}</p>}
        </>);
    }

    if (over) {
        return frame('player--over', <button type="button" className="player__end" onClick={finish} autoFocus>Завершить</button>);
    }

    // До первого задания таймер стоит на полном времени: отсчёт начнётся с него.
    const shown = endAt == null ? min * 60 : left;

    return frame('', <>
            <div className="player__top">
                <span className={`player__timer${shown < 0 ? ' player__timer--over' : ''}`} role="timer"
                    aria-label={shown < 0 ? 'Время вышло, сверх него' : 'Осталось времени'}>
                    <i aria-hidden="true" />{clock(shown)}
                </span>
                <div className="player__trail" aria-label="Ответы">
                    {marks.map((m, i) => <span key={i} className={`player__mark player__mark--${m}`} />)}
                    {current && done == null && <span className="player__mark player__mark--now" />}
                </div>
                <button type="button" className="player__finish" onClick={finish}>Завершить</button>
            </div>

            <div className="player__body">
                {loading ? (
                    <span className="player__wait" role="status" aria-label="Составляю задание…" />
                ) : error ? (
                    <p className="error">{error}</p>
                ) : current && (
                    <div className="player__exercise">
                        <p className="player__unit">{current.targetName}</p>
                        <ActionsSlot.Provider value={slot}>
                            <AnyExercise key={current.exercise.id} exercise={current.exercise} targetName={current.targetName} onDone={onDone} />
                        </ActionsSlot.Provider>
                    </div>
                )}
            </div>

            <div className={`player__bottom${done == null ? '' : done ? ' player__bottom--ok' : ' player__bottom--bad'}`}>
                {done == null ? (
                    (current || error) && !loading && <button type="button" className="player__skip" onClick={skip}>Пропустить</button>
                ) : (
                    <b className="player__verdict" role="status">{done ? 'Верно' : 'Не совсем'}</b>
                )}
                {/* Сюда задание выносит свои кнопки: «Проверить», счётчик, «Показать разбор». */}
                <div ref={setSlot} className="player__slot" />
                {done != null && (
                    <button type="button" className="player__next" onClick={advance} autoFocus>
                        {left < 0 ? 'Закончить' : 'Дальше'}
                    </button>
                )}
            </div>
    </>);
}
