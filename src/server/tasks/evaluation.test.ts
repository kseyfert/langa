// Нормализация ответа проверки: какие issues остаются рядом с целевым фрагментом.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalize } from './evaluation';

const TARGET = 8;

/** Ответ модели: целевой юнит со статусом и фрагментом, одно замечание в other_issues. */
const raw = (status: string, fragment: string, issue: string) => ({
    verdict: status === 'correct' ? 'correct_target' : 'incorrect',
    summary_ru: '',
    target_unit: { status, score: status === 'correct' ? 90 : 40, fragment, fix: '', comment_ru: '' },
    other_units: [],
    other_issues: [{ fragment: issue, fix: 'shrewd at spotting', comment_ru: 'нужен предлог at' }],
    corrected_answer: '',
    natural_version: '',
});

const ANSWER = 'She is very intelligent and has a great talent for design. She is shrewd with spotting problems';

test('correct: замечание внутри целевого фрагмента остаётся', () => {
    const e = normalize(raw('correct', ANSWER, 'shrewd with spotting'), TARGET, new Set([TARGET]), new Set());
    assert.deepEqual(e.issues.map((i) => i.fragment), ['shrewd with spotting']);
});

test('error: замечание внутри целевого фрагмента отбрасывается — это та же ошибка', () => {
    const e = normalize(raw('error', 'shrewd with spotting problems', 'shrewd with spotting'), TARGET, new Set([TARGET]), new Set());
    assert.deepEqual(e.issues, []);
});
