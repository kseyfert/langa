// Статья юнита: какие абзацы становятся встраиванием, какие остаются ссылкой; сырой HTML — текстом.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { embedFor, renderArticle } from './article';

/** Список слов плейсхолдера YouGlish из data-yg-items; null — плейсхолдера нет. */
function ygItems(html: string): unknown {
    const m = /data-yg-items="([^"]*)"/.exec(html);
    if (!m) return null;
    return JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
}
const yg = (word: string, accent = 'uk') => `https://youglish.com/pronounce/${word}/english/${accent}`;

test('YouTube: watch, youtu.be, t и start → iframe youtube-nocookie', () => {
    assert.deepEqual(embedFor('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), { kind: 'youtube', id: 'dQw4w9WgXcQ', start: null });
    assert.deepEqual(embedFor('https://youtu.be/dQw4w9WgXcQ?t=90'), { kind: 'youtube', id: 'dQw4w9WgXcQ', start: 90 });
    assert.deepEqual(embedFor('https://youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s'), { kind: 'youtube', id: 'dQw4w9WgXcQ', start: 90 });
    assert.deepEqual(embedFor('https://m.youtube.com/watch?v=dQw4w9WgXcQ&start=42'), { kind: 'youtube', id: 'dQw4w9WgXcQ', start: 42 });
    const html = renderArticle('Посмотри:\n\nhttps://youtu.be/dQw4w9WgXcQ?t=90\n');
    assert.match(html, /<iframe src="https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?start=90"[^>]* loading="lazy"/);
    assert.doesNotMatch(html, /<a /);
});

test('YouTube не того вида — ссылка', () => {
    assert.equal(embedFor('https://www.youtube.com/channel/UC123'), null);
    assert.equal(embedFor('https://www.youtube.com/watch?v=short'), null);
});

test('аудио с upload.wikimedia.org → <audio>, подпись — текст ссылки', () => {
    const html = renderArticle('[ship /ʃɪp/](https://upload.wikimedia.org/wikipedia/commons/a/ab/En-uk-ship.ogg)');
    assert.match(html, /<audio controls preload="none" src="https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/a\/ab\/En-uk-ship\.ogg"><\/audio>/);
    assert.match(html, /<figcaption>ship \/ʃɪp\/<\/figcaption>/);
    // Голый URL — без подписи.
    assert.doesNotMatch(renderArticle('https://upload.wikimedia.org/x/En-us-sheep.mp3'), /figcaption/);
    // Не аудио и не тот хост — ссылки.
    assert.equal(embedFor('https://upload.wikimedia.org/x/Ship.jpg'), null);
    assert.equal(embedFor('https://example.com/ship.mp3'), null);
});

test('YouGlish → плейсхолдер со словом и акцентом, без скрипта', () => {
    assert.deepEqual(embedFor('https://youglish.com/pronounce/thought/english/uk'), { kind: 'youglish', word: 'thought', accent: 'uk' });
    assert.deepEqual(embedFor('https://youglish.com/pronounce/good%20luck/english'), { kind: 'youglish', word: 'good luck', accent: null });
    assert.equal(embedFor('https://youglish.com/pronounce/thought/french'), null);
    assert.equal(embedFor('https://youglish.com/pronounce/thought/english/xx'), null);
    const html = renderArticle('https://youglish.com/pronounce/thought/english/uk');
    assert.deepEqual(ygItems(html), [{ word: 'thought', accent: 'uk', label: 'thought' }]);
    assert.match(html, /<button type="button" class="btn article__yg" data-yg-items=/);
    assert.match(html, /thought<\/span> — в живой речи \(YouGlish\)/);
    assert.doesNotMatch(html, /<script|widget\.js/);
});

test('YouGlish: абзац из ссылок — один виджет со списком слов в порядке ссылок', () => {
    // Подписанные ссылки через « · »: подпись — текст ссылки.
    const signed = renderArticle(`[made](${yg('made')}) · [mad](${yg('mad')}) · [pain](${yg('pain')}) · [pan](${yg('pan')})`);
    assert.deepEqual(ygItems(signed), ['made', 'mad', 'pain', 'pan'].map((w) => ({ word: w, accent: 'uk', label: w })));
    assert.match(signed, /made · mad · pain · pan<\/span> — в живой речи \(YouGlish\)/);
    assert.equal((signed.match(/<button/g) ?? []).length, 1);
    // Голые URL через пробел и через запятую: подпись — слово из адреса.
    assert.deepEqual(ygItems(renderArticle(`${yg('ship')} ${yg('sheep')}`)), [
        { word: 'ship', accent: 'uk', label: 'ship' }, { word: 'sheep', accent: 'uk', label: 'sheep' },
    ]);
    assert.deepEqual(ygItems(renderArticle(`${yg('ship')}, ${yg('sheep')}`)), [
        { word: 'ship', accent: 'uk', label: 'ship' }, { word: 'sheep', accent: 'uk', label: 'sheep' },
    ]);
    // Разные акценты — у каждого пункта свой.
    assert.deepEqual(ygItems(renderArticle(`[water UK](${yg('water', 'uk')}) · [water US](${yg('water', 'us')})`)), [
        { word: 'water', accent: 'uk', label: 'water UK' }, { word: 'water', accent: 'us', label: 'water US' },
    ]);
});

test('YouGlish: текст или ссылка мимо белого списка в абзаце — обычные ссылки, не виджет', () => {
    const mixed = renderArticle(`Сравни ${yg('ship')} и ${yg('sheep')}`);
    assert.equal(ygItems(mixed), null);
    assert.match(mixed, /<p>Сравни <a href="https:\/\/youglish\.com\/pronounce\/ship\/english\/uk">/);
    const foreign = renderArticle(`[ship](${yg('ship')}) · [sheep](https://example.com/sheep)`);
    assert.equal(ygItems(foreign), null);
    assert.match(foreign, /<a href="https:\/\/example\.com\/sheep">sheep<\/a>/);
    assert.equal(ygItems(renderArticle(`${yg('ship')} ${yg('sheep', 'xx')}`)), null);
});

test('ссылка не одна в абзаце или не из белого списка — остаётся ссылкой', () => {
    assert.match(renderArticle('Видео: https://youtu.be/dQw4w9WgXcQ'), /<p>Видео: <a href="https:\/\/youtu\.be\/dQw4w9WgXcQ">/);
    assert.match(renderArticle('- https://youtu.be/dQw4w9WgXcQ'), /<li><a href=/);
    assert.match(renderArticle('https://vimeo.com/123'), /<p><a href="https:\/\/vimeo\.com\/123">/);
    assert.match(renderArticle('[Cambridge](https://dictionary.cambridge.org/)'), /<a href="https:\/\/dictionary\.cambridge\.org\/">Cambridge<\/a>/);
});

test('сырой HTML и javascript:-ссылки не исполняются', () => {
    const html = renderArticle('<script>alert(1)</script>\n\nТекст <img src=x onerror=alert(1)> и [клик](javascript:alert(1))');
    assert.doesNotMatch(html, /<script|<img|href="javascript/);
    assert.match(html, /&lt;script&gt;/);
    assert.match(html, /и клик<\/p>/);
});
