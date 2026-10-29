// Статья юнита: какие абзацы становятся встраиванием, какие остаются ссылкой; сырой HTML — текстом.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { embedFor, renderArticle } from './article';

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
    assert.match(html, /<button type="button" class="btn article__yg" data-yg-word="thought" data-yg-accent="uk">/);
    assert.match(html, /thought<\/span> — в живой речи \(YouGlish\)/);
    assert.doesNotMatch(html, /<script|widget\.js/);
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
