'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@/components/Icon';
import type { YouglishItem } from '@/server/catalog/article';
import './Article.css';

type YGWidget = {
    fetch(query: string, lang: string, accent?: string): void;
    previous(): void;
    next(): void;
    replay(): void;
    setSpeed(rate: number): void;
    close(): void;
};
type YGApi = { Widget: new (id: string, options: Record<string, unknown>) => YGWidget };
declare global {
    interface Window {
        onYouglishAPIReady?: () => void;
        YG?: YGApi;
    }
}

/**
 * От интерфейса YouGlish — только видео: субтитр и управление наши. Строкой, а не числом: widget.js
 * подменяет ложное components (0) на 255 — весь их интерфейс; «0» истинно и даёт ноль флагов.
 */
const YOUGLISH_COMPONENTS = '0';
/** Шире виджет не нужен: это пример в живой речи, а не главное на странице. */
const YOUGLISH_WIDTH = 480;
/**
 * Видимая часть их iframe — только плеер: рекламный блок и «powered by» под ним уходят за край. Плеер в iframe не 16:9: при ширине 454 (колонка статьи на
 * десктопе) он занимает полосу 1–215px, высоту задаёт их вёрстка, а не ширина — замерено в браузере
 * 2026-10-29. Уже iframe — плеер ниже, и из-под края покажется их зазор: обрезка видна сразу.
 */
const YOUGLISH_VIDEO_HEIGHT = 216;
const SPEEDS = [0.75, 1];

// Скрипт YouGlish — один раз на страницу и только после первого нажатия: до него от YouGlish не грузится ничего.
let youglish: Promise<YGApi> | null = null;
function loadYouglish(): Promise<YGApi> {
    youglish ??= new Promise((resolve, reject) => {
        window.onYouglishAPIReady = () => resolve(window.YG!);
        const s = document.createElement('script');
        s.src = 'https://youglish.com/public/emb/widget.js';
        s.async = true;
        s.onerror = () => {
            youglish = null;
            s.remove();
            reject(new Error('YouGlish не загрузился'));
        };
        document.head.append(s);
    });
    return youglish;
}

let widgets = 0;

/** Цвета их iframe — из токенов страницы на момент открытия: в тёмной теме свои. */
function tokenColors(): Record<string, string> {
    const css = getComputedStyle(document.documentElement);
    const v = (name: string) => css.getPropertyValue(name).trim();
    return {
        backgroundColor: v('--paper-lift'),
        panelsBackgroundColor: v('--paper-deep'),
        textColor: v('--ink-soft'),
        linkColor: v('--speak'),
        markerColor: v('--speak-bg'),
    };
}

/** Субтитр YouGlish приходит URL-кодированным; искомое слово в [[[…]]] — нечётные куски. */
function captionParts(caption: string): string[] {
    let text = caption;
    try { text = decodeURIComponent(caption); } catch { /* уже раскодирован */ }
    return text.split(/\[\[\[(.*?)\]\]\]/);
}

/** Сколько слов видно в переключателе; остальные — за краем окна. */
const WORDS_VISIBLE = 3;

/**
 * Переключатель слов: окно на WORDS_VISIBLE слов, выбранное по возможности в середине. Смена слова —
 * подложка выбранного и лента едут к новому месту (transition в CSS), а не перескакивают. Шаг к
 * соседнему слову — треугольники на краях: не шевроны, как у кнопок примеров справа.
 */
function WordPicker({ items, pick, onPick }: { items: YouglishItem[]; pick: number; onPick: (i: number) => void }) {
    const n = items.length;
    const off = Math.max(0, Math.min(pick - 1, n - WORDS_VISIBLE));
    const last = Math.min(off + WORDS_VISIBLE, n) - 1;
    const opts = useRef<(HTMLButtonElement | null)[]>([]);
    const [geo, setGeo] = useState<{ x: number; w: number; px: number; pw: number } | null>(null);
    const steps = n > WORDS_VISIBLE;

    // До отрисовки: сдвиг ленты и подложка — по замеру слов, ширина у них разная. Окно — по самому
    // широкому из возможных окон, постоянное: стрелки по краям не ездят вместе с лентой;
    // тройка поуже стоит в нём по центру.
    useLayoutEffect(() => {
        const els = opts.current.slice(0, n) as HTMLButtonElement[];
        const span = (a: number, b: number) => els[b].offsetLeft + els[b].offsetWidth - els[a].offsetLeft;
        let w = 0;
        for (let o = 0; o + WORDS_VISIBLE <= n || o === 0; o++) w = Math.max(w, span(o, Math.min(o + WORDS_VISIBLE, n) - 1));
        setGeo({ x: els[off].offsetLeft - (w - span(off, last)) / 2, w, px: els[pick].offsetLeft, pw: els[pick].offsetWidth });
    }, [n, off, last, pick]);

    return (
        <span className="yg__words">
            {steps && (
                <button type="button" className="yg__step" title="Предыдущее слово" aria-label="Предыдущее слово"
                    disabled={pick === 0} onClick={() => onPick(pick - 1)}>
                    <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true"><path d="M6 1L2 4l4 3z" fill="currentColor" /></svg>
                </button>
            )}
            <span className="yg__window" style={geo ? { width: geo.w } : undefined}>
                <span className="yg__track" role="radiogroup" aria-label="Слово" style={geo ? { transform: `translateX(${-geo.x}px)` } : undefined}>
                    {geo && <span className="yg__pill" style={{ transform: `translateX(${geo.px}px)`, width: geo.pw }} />}
                    {items.map((it, i) => (
                        // Слова вне трёх видимых — без Tab (фокус прокрутил бы окно мимо сдвига ленты) и прозрачные:
                        // окно шире узкой тройки, и соседнее слово иначе выглядывало бы обрезанным.
                        <button key={i} ref={(el) => { opts.current[i] = el; }} type="button" role="radio" aria-checked={pick === i}
                            tabIndex={i >= off && i <= last ? 0 : -1}
                            className={`yg__opt${pick === i ? ' yg__opt--on' : ''}${i < off || i > last ? ' yg__opt--out' : ''}`} onClick={() => onPick(i)}>
                            {it.label}
                            {it.accent && <sub className="yg__accent">{it.accent}</sub>}
                        </button>
                    ))}
                </span>
            </span>
            {steps && (
                <button type="button" className="yg__step" title="Следующее слово" aria-label="Следующее слово"
                    disabled={pick === n - 1} onClick={() => onPick(pick + 1)}>
                    <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true"><path d="M2 1l4 3-4 3z" fill="currentColor" /></svg>
                </button>
            )}
        </span>
    );
}

/**
 * Виджет на список слов (абзац из ссылок YouGlish): переключатель слов в шапке, выбрано первое.
 * Скорость одна на виджет и переживает смену слова и примера.
 */
function Youglish({ YG, items }: { YG: YGApi; items: YouglishItem[] }) {
    const frame = useRef<HTMLDivElement>(null);
    const widget = useRef<YGWidget | null>(null);
    const [pick, setPick] = useState(0);
    const [caption, setCaption] = useState('');
    const [total, setTotal] = useState<number | null>(null);
    const [speed, setSpeed] = useState(1);
    const speedRef = useRef(speed);

    useEffect(() => {
        // widget.js заменяет свой элемент через outerHTML — поэтому ему отдаётся не узел React, а вложенный.
        const host = frame.current!;
        const el = document.createElement('div');
        el.id = `youglish-${++widgets}`;
        host.append(el);
        const w = new YG.Widget(el.id, {
            components: YOUGLISH_COMPONENTS,
            width: Math.min(YOUGLISH_WIDTH, host.clientWidth),
            autoStart: 1,
            ...tokenColors(),
            events: {
                onFetchDone: (e: { totalResult: number }) => setTotal(e.totalResult),
                // Новый пример (и новое слово) YouGlish запускает на обычной скорости — выбранная ставится заново.
                onVideoChange: () => {
                    setCaption('');
                    if (speedRef.current !== 1) w.setSpeed(speedRef.current);
                },
                onCaptionChange: (e: { caption: string }) => setCaption(e.caption),
            },
        });
        widget.current = w;
        return () => {
            try { w.close(); } catch { /* виджет уже снят вместе с разметкой */ }
            host.replaceChildren();
            widget.current = null;
        };
    }, [YG]);

    useEffect(() => {
        const { word, accent } = items[pick];
        setCaption('');
        setTotal(null);
        widget.current?.fetch(word, 'english', accent ?? undefined);
    }, [YG, items, pick]);

    const pickSpeed = (s: number) => {
        setSpeed(s);
        speedRef.current = s;
        widget.current?.setSpeed(s);
    };
    const found = total !== 0;

    return (
        <div className="yg">
            <div className="yg__bar">
                {items.length > 1 ? (
                    <WordPicker items={items} pick={pick} onPick={setPick} />
                ) : (
                    <span className="yg__word">
                        {items[0].label}
                        {items[0].accent && <sub className="yg__accent">{items[0].accent}</sub>}
                    </span>
                )}
                {/* Управление — одной группой у правого края: не влезло рядом со словами — переносится целиком. */}
                <span className="yg__controls">
                    <button type="button" className="icon-btn" title="Предыдущий пример" aria-label="Предыдущий пример"
                        disabled={!found} onClick={() => widget.current?.previous()}>
                        <Icon name="prev" />
                    </button>
                    <button type="button" className="icon-btn" title="Следующий пример" aria-label="Следующий пример"
                        disabled={!found} onClick={() => widget.current?.next()}>
                        <Icon name="next" />
                    </button>
                    <button type="button" className="icon-btn" title="Ещё раз" aria-label="Ещё раз"
                        disabled={!found} onClick={() => widget.current?.replay()}>
                        <Icon name="regen" />
                    </button>
                    <span className="choice yg__speed" role="radiogroup" aria-label="Скорость">
                        {SPEEDS.map((s) => (
                            <button key={s} type="button" role="radio" aria-checked={speed === s}
                                className={`choice__opt mono${speed === s ? ' choice__opt--on' : ''}`} onClick={() => pickSpeed(s)}>
                                {s}
                            </button>
                        ))}
                    </span>
                </span>
            </div>
            {/* Место — всегда на две строки: субтитры меняются, а виджет не прыгает. Текст прижат вниз, к видео. */}
            <p className={`yg__caption${caption ? '' : ' yg__caption--empty'}`} aria-live="polite">
                <span className="yg__caption-text">
                    {caption
                        ? captionParts(caption).map((part, i) => (i % 2 ? <mark key={i} className="yg__mark">{part}</mark> : part))
                        : total === null ? 'Ищу примеры…' : total === 0 ? 'Примеров не нашлось.' : ''}
                </span>
            </p>
            {/* iframe YouGlish, обрезанный по плееру. */}
            <div ref={frame} className="yg__frame" style={{ height: YOUGLISH_VIDEO_HEIGHT }} />
        </div>
    );
}

type Open = { key: number; host: HTMLElement; items: YouglishItem[] };

/**
 * Статья юнита (catalog-spec.md, «Статья юнита»): HTML готовит на сервере renderArticle. Здесь — только
 * виджеты YouGlish: на место .article__yg виджет встаёт сам, когда место видно (строка раскрыта). Раньше —
 * нет: каждый виджет тратит поиск из дневной квоты YouGlish, а свёрнутых статей на странице десятки.
 */
export function Article({ html }: { html: string }) {
    const box = useRef<HTMLDivElement>(null);
    const [YG, setYG] = useState<YGApi | null>(null);
    const [open, setOpen] = useState<Open[]>([]);

    useEffect(() => {
        const slots = [...box.current!.querySelectorAll<HTMLElement>('.article__yg')];
        if (!slots.length) return;
        // Свёрнутая строка — высота 0 под overflow: hidden: место не пересекает окно, пока строку не раскроют.
        const io = new IntersectionObserver((entries) => {
            for (const e of entries) {
                if (!e.isIntersecting) continue;
                io.unobserve(e.target);
                const host = e.target as HTMLElement;
                const items = JSON.parse(host.dataset.ygItems ?? '[]') as YouglishItem[];
                if (!items.length) continue;
                loadYouglish().then(
                    (api) => {
                        setYG(api);
                        host.replaceChildren();
                        setOpen((list) => [...list, { key: ++widgets, host, items }]);
                    },
                    (err) => {
                        host.firstElementChild!.textContent = err instanceof Error ? err.message : String(err);
                    },
                );
            }
        }, { threshold: 0.1 });
        slots.forEach((s) => io.observe(s));
        return () => io.disconnect();
    }, [html]);

    return (
        <>
            {/* Статью пишет сам пользователь; сырой HTML в ней renderArticle показывает текстом. */}
            <div ref={box} className="article" dangerouslySetInnerHTML={{ __html: html }} />
            {YG && open.map((o) => createPortal(<Youglish YG={YG} items={o.items} />, o.host, o.key))}
        </>
    );
}
