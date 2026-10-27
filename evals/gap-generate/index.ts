import type { GapContent } from '../../src/server/exercises/types';
import { closedGenerateSuite, code, type ItemVerdict } from '../closed-generate';

// Evals генерации gap (architecture.md, «Evals»): всё общее — в closed-generate.ts.
// Главное здесь — полный ключ: верный ответ, которого нет в answers, засчитывается ученику ошибкой.

type Item = GapContent['items'][number];

const quote = (xs: string[]) => xs.map((a) => `«${a}»`).join(', ');
const missing = (v: ItemVerdict) => v.missing_answers as string[];

export const suite = closedGenerateSuite<Item>({
    type: 'gap',
    criteria: [
        { key: 'rule', score: 'judge_rule', field: 'rule', pass: (v) => v.rule === true, issue: () => 'не решается правилом юнита' },
        {
            key: 'key_complete', score: 'judge_key_complete', field: 'missing_answers', list: true, keyList: true,
            pass: (v) => !missing(v).length, issue: (v) => `нет в answers: ${quote(missing(v))}`,
        },
        { key: 'not_guessable', score: 'judge_not_guessable', field: 'guessable', pass: (v) => v.guessable === false, issue: () => 'угадывается без правила' },
        { key: 'aux_inside', score: 'judge_aux_inside', field: 'aux_inside', pass: (v) => v.aux_inside === true, issue: () => 'вспомогательный глагол вне пропуска' },
        { key: 'focus_match', score: 'judge_focus', field: 'focus_match', pass: (v) => v.focus_match === true, issue: () => 'не по своему пункту focus' },
        { key: 'explain_ok', score: 'judge_explain', field: 'explain_ok', pass: (v) => v.explain_ok === true, issue: () => 'explain_ru неверен' },
    ],
    shown: (it, index, focus) => ({ index, text: it.text, answers: it.answers, explain_ru: it.explain_ru, focus }),
    lines: (it) => [`- text: ${code(it.text)}`, `- answers: ${it.answers.map(code).join(', ')}`],
});
