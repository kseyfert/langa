'use client';

import { useEffect, useRef, useState, useTransition, type CSSProperties, type ReactNode } from 'react';
import { domToBlob } from 'modern-screenshot';
import { Icon } from '@/components/Icon';
import { AnyExercise } from '@/components/exercises/AnyExercise';
import { ActionsSlot } from '@/components/exercises/ExerciseActions';
import type { ExerciseView } from '@/server/tasks';
import { nextSessionExercise, prepareNextExercise, sessionSummary } from '@/app/actions';
import { PLANNER_CONFIG } from '@/server/learner/planner';
import { SessionSummary } from './SessionSummary';
import './SessionPlayer.css';

const TIMES = PLANNER_CONFIG.SESSION_OPTIONS;
const DEFAULT_MIN = 15;
// Уход со вкладки или из окна ставит сессию на паузу. Снимается пауза вручную — тем же таймером.
const AUTO_PAUSE = true;

// Длительность запоминается в браузере — удобство, а не данные.
const MIN_KEY = 'langa:session-min';
const readMin = () => {
    try { const m = Number(localStorage.getItem(MIN_KEY)); return (TIMES as readonly number[]).includes(m) ? m : DEFAULT_MIN; } catch { return DEFAULT_MIN; }
};
const saveMin = (m: number) => {
    try { localStorage.setItem(MIN_KEY, String(m)); } catch { /* без памяти — не страшно */ }
};

type Current = { exercise: ExerciseView; targetName: string };
type Summary = Awaited<ReturnType<typeof sessionSummary>>;
type Mark = 'ok' | 'bad' | 'skip';

/** Время без знака: просроченное видно по красному таймеру. */
function clock(sec: number) {
    const a = Math.abs(sec);
    return `${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`;
}

/**
 * Прокрутка, прижимающая к верху окна экран с плеером — от заголовка области, а не
 * от рамки: так видно, где ты. Экран — родитель плеера, он начинается с заголовка.
 * Своя, а не scroll-behavior: та плавная для переходов по якорю и для смены задания слишком медленная.
 */
function pinToTop(player: HTMLElement) {
    const el = player.parentElement ?? player;
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

// Фокус на кнопку без прокрутки к ней: autoFocus дотягивал бы окно до низа рамки
// мимо pinToTop. Вне компонента — чтобы ref не менялся и фокус ставился один раз, при появлении.
const focusQuietly = (el: HTMLElement | null) => el?.focus({ preventScroll: true });

const PLAY = <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4.5 2.4v11.2L13.2 8z" /></svg>;
const PAUSE = <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="3.5" y="2.5" width="3" height="11" rx="1" /><rect x="9.5" y="2.5" width="3" height="11" rx="1" /></svg>;

/**
 * Плеер сессии: до старта — полоска с ▶ и длительностью, на старте рамка
 * раскрывается и задания идут одно за другим в ней. Время не обрывает задание: таймер
 * краснеет и считает дальше, а следующее задание после этого уже не берётся —
 * сессия заканчивается финальным экраном.
 */
export function SessionPlayer({ workspaceId }: { workspaceId: number }) {
    const [min, setMin] = useState(DEFAULT_MIN);
    const [endAt, setEndAt] = useState<number | null>(null);
    const [now, setNow] = useState(0);
    // Когда поставлена пауза; null — время идёт. При снятии конец сессии сдвигается на простой.
    const [pausedAt, setPausedAt] = useState<number | null>(null);
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
    // Задания сессии по порядку показа — для итога.
    const seen = useRef<number[]>([]);
    const [summary, setSummary] = useState<Summary | null>(null);

    // Из localStorage — после монтирования: на сервере его нет, иначе разойдётся гидратация.
    useEffect(() => setMin(readMin()), []);

    const paused = pausedAt != null;
    const running = endAt != null && !paused;
    useEffect(() => {
        if (!running) return;
        setNow(Date.now());
        const t = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(t);
    }, [running]);

    const left = endAt == null ? 0 : Math.round((endAt - (pausedAt ?? now)) / 1000);

    // Автопауза — только пока время идёт: после его конца пауза уже ничего не значит.
    useEffect(() => {
        if (!AUTO_PAUSE || !running || over) return;
        const pause = () => endAt != null && Date.now() < endAt && setPausedAt(Date.now());
        const onHide = () => document.hidden && pause();
        // blur — переход в другое окно, visibilitychange — во вкладку или свёрнутое окно.
        window.addEventListener('blur', pause);
        document.addEventListener('visibilitychange', onHide);
        return () => {
            window.removeEventListener('blur', pause);
            document.removeEventListener('visibilitychange', onHide);
        };
    }, [running, over, endAt]);

    // Итог копирования на месте значка; null — обычный значок.
    const [copied, setCopied] = useState<'ok' | 'cancel' | null>(null);
    // Плеер картинкой в буфер. Promise прямо в ClipboardItem: Safari пускает в буфер
    // только в самом обработчике клика, а снимок готовится дольше.
    const copyShot = () => {
        if (!box.current) return;
        const png = domToBlob(box.current, {
            scale: window.devicePixelRatio,
            filter: (n) => !(n instanceof Element && n.classList.contains('player__copy')),
        });
        navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
            .then(() => setCopied('ok'), () => setCopied('cancel'))
            .finally(() => setTimeout(() => setCopied(null), 1000));
    };
    // Одна и та же кнопка в задании и на экране итога: левый нижний угол тела рамки.
    const copyButton = (
        <span className={`player__copy${copied ? ' player__copy--done' : ''}`}>
            <button type="button" className="icon-btn" onClick={copyShot} tabIndex={-1}
                title={copied === 'cancel' ? 'Не скопировалось' : 'Скопировать картинкой'} aria-label="Скопировать плеер картинкой">
                <Icon name={copied ?? 'copy'} />
            </button>
        </span>
    );

    const togglePause = () => {
        if (pausedAt == null) return setPausedAt(Date.now());
        const idle = Date.now() - pausedAt;
        setEndAt((e) => e == null ? e : e + idle);
        setPausedAt(null);
    };

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

    /**
     * Показать задание и сразу заготовить следующее: пока решается это,
     * сервер составляет то, что планировщик дал бы дальше.
     */
    const show = (c: Current) => {
        seen.current.push(c.exercise.id);
        setCurrent(c);
        void prepareNextExercise(workspaceId);
    };

    const fetchNext = () => {
        const id = run.current;
        startLoading(async () => {
            const res = await nextSessionExercise(workspaceId);
            if (id !== run.current) return;
            if (!res.ok) return setError(res.error);
            show({ exercise: res.exercise, targetName: res.targetName });
        });
    };

    // Новый номер сессии: задание, которое ещё составляется, на экран итога уже не попадёт.
    const end = () => {
        const id = ++run.current;
        setOver(true);
        setSummary(null);
        void sessionSummary([...seen.current]).then((res) => id === run.current && setSummary(res));
    };

    /** Следующее задание — или конец сессии, если время уже вышло. */
    const advance = () => {
        clear();
        if (box.current) pinToTop(box.current);
        if (endAt != null && Date.now() > endAt) return end();
        fetchNext();
    };

    // Таймер идёт с первого задания, а не с нажатия: составление первого — не время сессии.
    // Нет заданий — рамка сворачивается обратно, и причина видна в полоске.
    const start = () => {
        const id = run.current;
        setError(null);
        setMarks([]);
        seen.current = [];
        resize('open');
        if (box.current) pinToTop(box.current);
        startLoading(async () => {
            const res = await nextSessionExercise(workspaceId);
            if (id !== run.current) return;
            if (!res.ok) {
                resize('close');
                return setError(res.error);
            }
            show({ exercise: res.exercise, targetName: res.targetName });
            setEndAt(Date.now() + min * 60_000);
        });
    };

    const skip = () => {
        if (current && done == null) setMarks((m) => [...m, 'skip']);
        advance();
    };

    const onDone = (ok: boolean) => {
        setDone(ok);
        // Разбор меняет высоту задания — окно возвращается туда же, где было при показе.
        if (box.current) pinToTop(box.current);
        setMarks((m) => [...m, ok ? 'ok' : 'bad']);
        // Ответ мог поменять план (побочная ошибка поднимает другой юнит) — заготовить заново.
        // Время вышло — следующего задания не будет.
        if (endAt != null && Date.now() <= endAt) void prepareNextExercise(workspaceId);
    };

    const finish = () => {
        run.current++;
        resize('close');
        clear();
        setEndAt(null);
        setPausedAt(null);
        setOver(false);
        setMarks([]);
        setSummary(null);
    };

    // «Завершить» посреди сессии — тоже через итог; не было ни одного задания — итогу не из чего быть.
    const stop = () => (seen.current.length ? end() : finish());

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
        return frame('player--over', <>
            <div className="player__body">
                {summary == null ? (
                    <span className="player__wait" role="status" aria-label="Считаю итог…" />
                ) : summary.ok ? (
                    <SessionSummary count={summary.count} units={summary.units} />
                ) : (
                    <p className="error">{summary.error}</p>
                )}
                {summary?.ok && copyButton}
            </div>
            <div className="player__bottom">
                <button type="button" className="player__next" onClick={finish} ref={focusQuietly}>Завершить</button>
            </div>
        </>);
    }

    // До первого задания таймер стоит на полном времени: отсчёт начнётся с него.
    const shown = endAt == null ? min * 60 : left;

    return frame('', <>
            <div className="player__top">
                {/* Таймер — он же кнопка паузы. До первого задания ставить на паузу нечего, а после конца времени — незачем. */}
                <button type="button" className={`player__timer${shown < 0 ? ' player__timer--over' : ''}${paused ? ' player__timer--paused' : ''}`}
                    onClick={togglePause} disabled={endAt == null || shown < 0} aria-pressed={paused} title={paused ? 'Продолжить' : 'Пауза'}
                    aria-label={`Пауза, ${shown < 0 ? 'сверх времени' : 'осталось'} ${clock(shown)}`}>
                    <span className="player__timer-ic"><i />{PAUSE}{PLAY}</span>{clock(shown)}
                </button>
                <div className="player__trail" aria-label="Ответы">
                    {marks.map((m, i) => <span key={i} className={`player__mark player__mark--${m}`} />)}
                    {current && done == null && <span className="player__mark player__mark--now" />}
                </div>
                <button type="button" className="player__finish" onClick={stop}>Завершить</button>
            </div>

            <div className="player__body" inert={paused}>
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
                {current && !loading && copyButton}
            </div>

            <div className={`player__bottom${done == null ? '' : done ? ' player__bottom--ok' : ' player__bottom--bad'}`} inert={paused}>
                {done == null ? (
                    (current || error) && !loading && <button type="button" className="player__skip" onClick={skip}>Пропустить</button>
                ) : (
                    <b className="player__verdict" role="status">{done ? 'Верно' : 'Не совсем'}</b>
                )}
                {/* Сюда задание выносит свои кнопки: «Проверить», счётчик, «Показать разбор». */}
                <div ref={setSlot} className="player__slot" />
                {done != null && (
                    <button type="button" className="player__next" onClick={advance} ref={focusQuietly}>
                        {left < 0 ? 'Закончить' : 'Дальше'}
                    </button>
                )}
            </div>
            {paused && <div className="player__veil" />}
    </>);
}
