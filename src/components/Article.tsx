'use client';

import type { MouseEvent } from 'react';
import './Article.css';

type YGWidget = { fetch(query: string, lang: string, accent?: string): void };
declare global {
    interface Window {
        onYouglishAPIReady?: () => void;
        YG?: { Widget: new (id: string, options: Record<string, unknown>) => YGWidget };
    }
}

/** Видео + субтитры (8) + кнопки управления, в том числе «следующий пример» (64): без поиска и лишних панелей. */
const YOUGLISH_COMPONENTS = 8 + 64;

// Скрипт YouGlish — один раз на страницу и только после первого нажатия: до него от YouGlish не грузится ничего.
let youglish: Promise<NonNullable<Window['YG']>> | null = null;
function loadYouglish(): Promise<NonNullable<Window['YG']>> {
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

/**
 * Статья юнита (catalog-spec.md, «Статья юнита»): HTML готовит на сервере renderArticle. Здесь — только
 * плейсхолдеры YouGlish: по нажатию на месте плейсхолдера встаёт виджет.
 */
export function Article({ html }: { html: string }) {
    const onClick = async (e: MouseEvent<HTMLDivElement>) => {
        const btn = (e.target as Element).closest<HTMLButtonElement>('.article__yg');
        if (!btn || btn.disabled) return;
        const { ygWord: word = '', ygAccent: accent } = btn.dataset;
        btn.disabled = true;
        btn.classList.add('article__yg--busy');
        try {
            const YG = await loadYouglish();
            const box = document.createElement('div');
            box.id = `youglish-${++widgets}`;
            box.className = 'article__yg-widget';
            btn.replaceWith(box);
            new YG.Widget(box.id, { components: YOUGLISH_COMPONENTS, autoStart: 1 }).fetch(word, 'english', accent);
        } catch (err) {
            btn.disabled = false;
            btn.classList.remove('article__yg--busy');
            btn.title = err instanceof Error ? err.message : String(err);
        }
    };
    // Статью пишет сам пользователь; сырой HTML в ней renderArticle показывает текстом.
    return <div className="article" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
}
