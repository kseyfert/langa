import { Marked, type Token, type Tokens } from 'marked';

/**
 * Хосты, с которых ссылка в статье становится встроенным элементом (catalog-spec.md, «Статья юнита»).
 * Всё остальное остаётся ссылкой.
 */
export const EMBED_HOSTS = {
    youtube: ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'],
    audio: ['upload.wikimedia.org'],
    youglish: ['youglish.com', 'www.youglish.com'],
} as const;

const AUDIO_EXT = /\.(mp3|ogg|oga|wav)$/i;
/** Акценты английского в JS API YouGlish. */
const YOUGLISH_ACCENTS = ['us', 'uk', 'aus', 'ca', 'ie', 'sco', 'nz'];

export type Embed =
    | { kind: 'youtube'; id: string; start: number | null }
    | { kind: 'audio'; src: string }
    | { kind: 'youglish'; word: string; accent: string | null };

/** t / start YouTube: «90», «90s», «1m30s», «1h2m3s» → секунды; непонятное — null. */
function seconds(v: string | null): number | null {
    if (!v) return null;
    const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(v);
    if (!m) return null;
    const s = Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
    return s > 0 ? s : null;
}

/** Что встроить вместо ссылки: null — адрес не из белого списка или не того вида. */
export function embedFor(href: string): Embed | null {
    let url: URL;
    try {
        url = new URL(href);
    } catch {
        return null;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    const host = url.hostname.toLowerCase();
    if ((EMBED_HOSTS.youtube as readonly string[]).includes(host)) {
        const id = host === 'youtu.be' ? url.pathname.slice(1) : url.pathname === '/watch' ? url.searchParams.get('v') : null;
        if (!id || !/^[\w-]{11}$/.test(id)) return null;
        return { kind: 'youtube', id, start: seconds(url.searchParams.get('t') ?? url.searchParams.get('start')) };
    }
    if ((EMBED_HOSTS.audio as readonly string[]).includes(host)) {
        return AUDIO_EXT.test(url.pathname) ? { kind: 'audio', src: url.href } : null;
    }
    if ((EMBED_HOSTS.youglish as readonly string[]).includes(host)) {
        const m = /^\/pronounce\/([^/]+)\/english(?:\/([a-z]+))?\/?$/.exec(url.pathname);
        if (!m || (m[2] && !YOUGLISH_ACCENTS.includes(m[2]))) return null;
        let word: string;
        try {
            word = decodeURIComponent(m[1]).trim();
        } catch {
            return null;
        }
        return word ? { kind: 'youglish', word, accent: m[2] ?? null } : null;
    }
    return null;
}

/** Пункт виджета YouGlish; label — текст ссылки, у голого URL — слово из адреса. */
export type YouglishItem = { word: string; accent: string | null; label: string };

/**
 * Абзац только из ссылок YouGlish (голые URL или [подпись](URL)) через пробелы, запятые или « · » —
 * список слов одного виджета в порядке ссылок; что-то ещё в абзаце или ссылка мимо белого списка — null.
 */
function youglishList(tokens: Token[]): YouglishItem[] | null {
    const items: YouglishItem[] = [];
    for (const t of tokens) {
        if (t.type === 'text' && /^[\s,·]*$/.test(t.raw)) continue;
        if (t.type !== 'link') return null;
        const link = t as Tokens.Link;
        const e = embedFor(link.href);
        if (e?.kind !== 'youglish') return null;
        items.push({ word: e.word, accent: e.accent, label: link.text && link.text !== link.href ? link.text : e.word });
    }
    return items.length ? items : null;
}

const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Значок ▶ — тот же путь, что play в Icon.tsx: символ ▶ на части систем рисуется эмодзи. */
const PLAY = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 3.2v9.6L12.6 8z"/></svg>';

/** Плейсхолдер YouGlish: виджет и скрипт грузит по нажатию Article.tsx, список слов — в data-yg-items. */
function youglishHtml(items: YouglishItem[]): string {
    const words = items.map((i) => escape(i.label)).join(' · ');
    return `<p><button type="button" class="btn article__yg" data-yg-items="${escape(JSON.stringify(items))}">`
        + `${PLAY}<span><span class="article__yg-word">${words}</span> — в живой речи (YouGlish)</span></button></p>\n`;
}

/** caption — текст ссылки; у голого URL он равен адресу, и подписи нет. YouGlish — youglishHtml. */
function embedHtml(e: Exclude<Embed, { kind: 'youglish' }>, caption: string | null): string {
    switch (e.kind) {
        case 'youtube': {
            const src = `https://www.youtube-nocookie.com/embed/${e.id}${e.start ? `?start=${e.start}` : ''}`;
            return `<div class="article__video"><iframe src="${src}" title="${escape(caption ?? 'YouTube')}" loading="lazy" `
                + 'allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" '
                + 'referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></div>\n';
        }
        case 'audio':
            return `<figure class="article__audio"><audio controls preload="none" src="${escape(e.src)}"></audio>`
                + (caption ? `<figcaption>${escape(caption)}</figcaption>` : '') + '</figure>\n';
    }
}

const SAFE_HREF = /^(https?:|mailto:|#|\/)/i;

const marked = new Marked({
    renderer: {
        // Абзац из ссылок YouGlish — один виджет со списком слов. Иначе ссылка одна в своём абзаце
        // (голый URL или [подпись](URL)) с адресом из EMBED_HOSTS — встроенный элемент.
        paragraph({ tokens }: Tokens.Paragraph) {
            const words = youglishList(tokens);
            if (words) return youglishHtml(words);
            const solo = tokens.filter((t) => !(t.type === 'text' && !t.raw.trim()));
            if (solo.length !== 1 || solo[0].type !== 'link') return false;
            const link = solo[0] as Tokens.Link;
            const embed = embedFor(link.href);
            if (!embed || embed.kind === 'youglish') return false;
            return embedHtml(embed, link.text && link.text !== link.href ? link.text : null);
        },
        // Сырой HTML в статье не исполняется — показывается текстом.
        html({ text }: Tokens.HTML | Tokens.Tag) {
            return escape(text);
        },
        // javascript: и прочие схемы — только текст ссылки.
        link({ href, tokens }: Tokens.Link) {
            return SAFE_HREF.test(href) ? false : this.parser.parseInline(tokens);
        },
    },
});

/** Статья юнита (markdown) → HTML для Article.tsx. Чистая функция: рендерится на сервере. */
export function renderArticle(md: string): string {
    return marked.parse(md, { async: false });
}
