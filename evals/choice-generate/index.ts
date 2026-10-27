import type { ChoiceContent } from '../../src/server/exercises/types';
import { closedGenerateSuite, code } from '../closed-generate';

// Evals генерации choice (architecture.md, «Evals»): всё общее — в closed-generate.ts.
// Главное здесь — верный дистрактор: он засчитывает ученику ошибку за правильный ответ.

type Item = ChoiceContent['items'][number];

/**
 * Проверка пункта сверх normalize: тот отбрасывает только пункты не той формы,
 * а лишний вариант или вариант-дубль доходят до ученика.
 */
function invalid(it: Item): string | undefined {
    if (it.options.length > 3) return `вариантов ${it.options.length}, нужно 2–3`;
    // По точному тексту, не после norm: варианты, различающиеся только знаком, допустимы (юнит 50).
    if (new Set(it.options.map((x) => x.trim())).size !== it.options.length) return 'варианты повторяются';
}

export const suite = closedGenerateSuite<Item>({
    type: 'choice',
    criteria: [
        { key: 'rule', score: 'judge_rule', field: 'rule', pass: (v) => v.rule === true, issue: () => 'не решается правилом юнита' },
        { key: 'one_correct', score: 'judge_one_correct', field: 'one_correct', pass: (v) => v.one_correct === true, issue: () => 'верен не ровно один вариант' },
        { key: 'distractors_plausible', score: 'judge_distractors', field: 'distractors_plausible', pass: (v) => v.distractors_plausible === true, issue: () => 'дистрактор — не типичная ошибка' },
        { key: 'not_guessable', score: 'judge_not_guessable', field: 'guessable', pass: (v) => v.guessable === false, issue: () => 'угадывается без правила' },
        { key: 'aux_inside', score: 'judge_aux_inside', field: 'aux_inside', pass: (v) => v.aux_inside === true, issue: () => 'вспомогательный глагол вне вариантов' },
        { key: 'focus_match', score: 'judge_focus', field: 'focus_match', pass: (v) => v.focus_match === true, issue: () => 'не по своему пункту focus' },
        { key: 'explain_ok', score: 'judge_explain', field: 'explain_ok', pass: (v) => v.explain_ok === true, issue: () => 'explain_ru неверен' },
    ],
    // answer рядом с индексом: судье не нужно отсчитывать его самому.
    shown: (it, index, focus) => ({
        index, text: it.text, options: it.options, correct: it.correct, answer: it.options[it.correct], explain_ru: it.explain_ru, focus,
    }),
    // Верный вариант — жирным: так ключ виден без отсчёта индекса.
    lines: (it) => [`- text: ${code(it.text)}`, `- options: ${it.options.map((x, k) => (k === it.correct ? `**${code(x)}**` : code(x))).join(' · ')}`],
    invalid,
});
