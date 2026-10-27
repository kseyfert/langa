// Чистка строк ответа модели: хвостовые «}» и пробелы — во всех строках, рекурсивно.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { trimBraceTails } from './trim';

test('хвостовые «}» и пробелы обрезаются во всех строках, в том числе в массивах и вложенных объектах', () => {
    const raw = {
        source_ru: 'Текст.',
        reference_en: ['One translation.}', 'Another. } '],
        target_note_ru: 'Обрати внимание на thaw.}',
        items: [{ text: 'A ___ day.', explain_ru: 'Потому что так.}}\n' }],
        correct: 1,
        ok: true,
        none: null,
    };
    assert.deepEqual(trimBraceTails(raw), {
        source_ru: 'Текст.',
        reference_en: ['One translation.', 'Another.'],
        target_note_ru: 'Обрати внимание на thaw.',
        items: [{ text: 'A ___ day.', explain_ru: 'Потому что так.' }],
        correct: 1,
        ok: true,
        none: null,
    });
});

test('«}» не в конце строки и пустая строка не меняются', () => {
    assert.equal(trimBraceTails('a {b} c'), 'a {b} c');
    assert.equal(trimBraceTails(''), '');
});
