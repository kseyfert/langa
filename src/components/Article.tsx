'use client';

import { useEffect, useRef, useState, type MouseEvent } from 'react';
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

/**
 * Виджет на список слов (абзац из ссылок YouGlish): переключатель слов в шапке, выбрано первое.
 * Скорость одна на виджет и переживает смену слова и примера.
 */
function Youglish({ YG, items, onClose }: { YG: YGApi; items: YouglishItem[]; onClose: () => void }) {
    const frame = useRef<HTMLDivElement>(null);
    const widget = useRef<YGWidget | null>(null);
    const [pick, setPick] = useState(0);
    const [caption, setCaption] = useState('');
    const [total, setTotal] = useState<number | null>(null);
    const [speed, setSpeed] = useState(1);
    const speedRef = useRef(speed);
    // Акцент — у подписи, только если в списке они разные: иначе он ничего не различает.
    const accents = new Set(items.map((i) => i.accent)).size > 1;

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
                    <span className="choice yg__words" role="radiogroup" aria-label="Слово">
                        {items.map((it, i) => (
                            <button key={i} type="button" role="radio" aria-checked={pick === i}
                                className={`choice__opt${pick === i ? ' choice__opt--on' : ''}`} onClick={() => setPick(i)}>
                                {it.label}
                                {accents && it.accent && <span className="yg__accent">{it.accent.toUpperCase()}</span>}
                            </button>
                        ))}
                    </span>
                ) : (
                    <span className="yg__word">{items[0].label}</span>
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
                    <button type="button" className="icon-btn" title="Свернуть" aria-label="Свернуть" onClick={onClose}>
                        <Icon name="cancel" />
                    </button>
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

type Open = { key: number; host: HTMLElement; btn: HTMLButtonElement; items: YouglishItem[] };

/**
 * Статья юнита (catalog-spec.md, «Статья юнита»): HTML готовит на сервере renderArticle. Здесь — только
 * плейсхолдеры YouGlish: по нажатию на месте плейсхолдера встаёт наш виджет вокруг их видео, × сворачивает обратно.
 */
export function Article({ html }: { html: string }) {
    const [YG, setYG] = useState<YGApi | null>(null);
    const [open, setOpen] = useState<Open[]>([]);

    const onClick = async (e: MouseEvent<HTMLDivElement>) => {
        const btn = (e.target as Element).closest<HTMLButtonElement>('.article__yg');
        if (!btn || btn.disabled) return;
        const items = JSON.parse(btn.dataset.ygItems ?? '[]') as YouglishItem[];
        if (!items.length) return;
        btn.disabled = true;
        btn.classList.add('article__yg--busy');
        try {
            setYG(await loadYouglish());
            // Плейсхолдер прячется, а не удаляется: × возвращает его на место.
            const host = document.createElement('div');
            btn.after(host);
            btn.hidden = true;
            setOpen((list) => [...list, { key: ++widgets, host, btn, items }]);
        } catch (err) {
            btn.title = err instanceof Error ? err.message : String(err);
        } finally {
            btn.disabled = false;
            btn.classList.remove('article__yg--busy');
        }
    };

    const close = (o: Open) => {
        setOpen((list) => list.filter((x) => x !== o));
        // Хост убирается после того, как React снимет портал.
        requestAnimationFrame(() => o.host.remove());
        o.btn.hidden = false;
        o.btn.focus();
    };

    return (
        <>
            {/* Статью пишет сам пользователь; сырой HTML в ней renderArticle показывает текстом. */}
            <div className="article" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
            {YG && open.map((o) => createPortal(
                <Youglish YG={YG} items={o.items} onClose={() => close(o)} />, o.host, o.key,
            ))}
        </>
    );
}
