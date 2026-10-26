import fs from 'node:fs';
import type { Evaluation, Evaluator, ExperimentItemResult } from '@langfuse/client';
import { getUnit } from '../../src/server/catalog';
import type { ChoiceContent } from '../../src/server/exercises/types';
import { choice } from '../../src/server/tasks/choice';
import { askJson } from '../../src/server/tasks/claude';
import { prompts, promptSet, unitValues } from '../../src/server/tasks/prompt';

// Evals генерации choice (architecture.md, «Evals»): настоящая генерация без записи в базу,
// оценки кодом и судьёй. Устроен как gap-generate; главное здесь — верный дистрактор:
// он засчитывает ученику ошибку за правильный ответ.

const ITEMS = 6;
const JUDGE_MODEL = 'claude-opus-5-5';
const JUDGE = 'evals/choice-generate/judge.md';
const judgePrompts = () => promptSet([{ name: 'judge' as const, file: JUDGE, text: fs.readFileSync(JUDGE, 'utf8') }]);

export type Input = { unit_id: number; topic: string };
export type Output = { content: ChoiceContent } | { error: string };
/** Что не так в пункте (item 0 — во всём задании). Лежит в metadata score и идёт в итог прогона. */
export type Problem = { item: number; issue: string };

type Item = ChoiceContent['items'][number];

/** Версии в имени и metadata прогона: сравнивать имеет смысл прогоны с одной версией судьи. */
export const versions = () => ({ prompt: prompts('choice', ['generate', 'focus-repeat']).version, judge: judgePrompts().version });

export async function task(input: Input): Promise<Output> {
    try {
        // Тема из случая, недавних заданий нет: случай воспроизводим и не зависит от лога.
        const g = await choice.generate(input.unit_id, { topic: input.topic, recent: [] });
        return { content: g.content };
    } catch (e) {
        // Сбой генерации — тоже результат прогона (valid_items 0), а не выпавший случай.
        return { error: e instanceof Error ? e.message : String(e) };
    }
}

/** Доля пунктов, где проверка прошла; что не прошло — в problems. */
function share(name: string, items: Item[], fail: (it: Item, i: number) => string | undefined): Evaluation {
    const problems = items.flatMap((it, i) => {
        const issue = fail(it, i);
        return issue ? [{ item: i + 1, issue }] : [];
    });
    return { name, value: (items.length - problems.length) / items.length, metadata: { problems } };
}

/**
 * Проверка пункта сверх normalize: тот отбрасывает только пункты не той формы,
 * а лишний вариант или вариант-дубль доходят до ученика.
 */
function invalid(it: Item): string | undefined {
    if (it.options.length > 3) return `вариантов ${it.options.length}, нужно 2–3`;
    // По точному тексту, не после norm: варианты, различающиеся только знаком, допустимы (юнит 50).
    if (new Set(it.options.map((x) => x.trim())).size !== it.options.length) return 'варианты повторяются';
}

export const codeChecks: Evaluator = async ({ output }) => {
    const o = output as Output;
    if ('error' in o) {
        return { name: 'valid_items', value: 0, comment: o.error, metadata: { problems: [{ item: 0, issue: `генерация не удалась: ${o.error}` }] } };
    }
    const items = o.content.items.slice(0, ITEMS);
    const problems: Problem[] = items.flatMap((it, i) => {
        const issue = invalid(it);
        return issue ? [{ item: i + 1, issue }] : [];
    });
    // Отброшенные normalize пункты не видны по отдельности — только как нехватка.
    if (o.content.items.length < ITEMS) problems.push({ item: 0, issue: `валидацию формы прошли ${o.content.items.length} пунктов из ${ITEMS}` });
    const valid = items.length - problems.filter((p) => p.item).length;
    return { name: 'valid_items', value: valid / ITEMS, comment: problems.map((p) => p.issue).join('; ') || undefined, metadata: { problems } };
};

export type Verdict = {
    rule: boolean; one_correct: boolean; distractors_plausible: boolean; guessable: boolean;
    aux_inside: boolean; focus_match: boolean; explain_ok: boolean; note_ru: string;
};

const BOOLS = ['rule', 'one_correct', 'distractors_plausible', 'guessable', 'aux_inside', 'focus_match', 'explain_ok'] as const;

/** Ответ судьи строго по схеме: иначе оценки не ставятся, а не угадываются. */
function verdicts(raw: unknown, n: number): Verdict[] {
    const list = (raw as { items?: unknown } | null)?.items;
    if (!Array.isArray(list) || list.length !== n) throw new Error(`судья: ожидалось ${n} пунктов`);
    return list.map((v, i) => {
        const o = (v ?? {}) as Record<string, unknown>;
        if (!BOOLS.every((k) => typeof o[k] === 'boolean') || typeof o.note_ru !== 'string') throw new Error(`судья: пункт ${i + 1} не по схеме`);
        return o as Verdict;
    });
}

/** Критерии судьи: score — доля прошедших пунктов. */
const CRITERIA: [name: string, pass: (v: Verdict) => boolean, issue: string][] = [
    ['judge_rule', (v) => v.rule, 'не решается правилом юнита'],
    ['judge_one_correct', (v) => v.one_correct, 'верен не ровно один вариант'],
    ['judge_distractors', (v) => v.distractors_plausible, 'дистрактор — не типичная ошибка'],
    ['judge_not_guessable', (v) => !v.guessable, 'угадывается без правила'],
    ['judge_aux_inside', (v) => v.aux_inside, 'вспомогательный глагол вне вариантов'],
    ['judge_focus', (v) => v.focus_match, 'не по своему пункту focus'],
    ['judge_explain', (v) => v.explain_ok, 'explain_ru неверен'],
];

/** LLM-судья: один вызов на задание, вердикт по каждому пункту. */
export const judge: Evaluator = async ({ input, output }) => {
    const o = output as Output;
    if ('error' in o) return [];
    const { unit_id } = input as Input;
    const p = judgePrompts();
    const unit = await getUnit(unit_id);
    const { items, focus } = o.content;
    // answer рядом с индексом: судье не нужно отсчитывать его самому.
    const shown = items.map((it, i) => ({
        index: i + 1, text: it.text, options: it.options, correct: it.correct, answer: it.options[it.correct],
        explain_ru: it.explain_ru, focus: focus?.[i] ?? '',
    }));
    const raw = await askJson(p.fill('judge', { ...unitValues(unit), items: JSON.stringify(shown, null, 1) }), JUDGE_MODEL, undefined, {
        call: 'judge', type: 'choice', promptVersion: p.version, unitId: unit_id, workspaceId: unit.workspaceId,
    });
    const vs = verdicts(raw, items.length);
    const scores = CRITERIA.map(([name, pass, issue]) => share(name, items, (_, i) => {
        const v = vs[i];
        if (pass(v)) return;
        // Пояснение судьи — к первому проваленному критерию пункта, чтобы не повторять его в каждом.
        const first = CRITERIA.find(([, ok]) => !ok(v))![0] === name;
        return first && v.note_ru ? `${issue} — ${v.note_ru}` : issue;
    }));
    // Вердикты целиком — для отчёта калибровки судьи. Один раз, в первом score, а не в каждом.
    scores[0].metadata = { ...(scores[0].metadata as object), verdicts: vs };
    return scores;
};

const verdictsOf = (r: ExperimentItemResult): Verdict[] | undefined =>
    (r.evaluations.find((e) => e.name === CRITERIA[0][0])?.metadata as { verdicts?: Verdict[] } | undefined)?.verdicts;

const code = (s: string) => `\`${s.replace(/`/g, "'")}\``;
/** Поле вердикта; проваленное — жирным, чтобы при калибровке взгляд цеплялся за него. */
const field = (name: string, value: unknown, ok: boolean) => (ok ? `${name}: ${JSON.stringify(value)}` : `**${name}: ${JSON.stringify(value)}**`);

/** Раздел отчёта по заданию: каждый пункт и вердикт судьи по нему целиком. */
export function reportItem(r: ExperimentItemResult): string {
    const o = r.output as Output;
    if ('error' in o) return `Ошибка генерации: ${o.error}`;
    const vs = verdictsOf(r);
    const out = vs ? [] : ['Судья не дал оценок.', ''];
    o.content.items.forEach((it, i) => {
        const v = vs?.[i];
        out.push(`### Пункт ${i + 1}`, '',
            `- text: ${code(it.text)}`,
            // Верный вариант — жирным: так ключ виден без отсчёта индекса.
            `- options: ${it.options.map((x, k) => (k === it.correct ? `**${code(x)}**` : code(x))).join(' · ')}`,
            `- focus: ${o.content.focus?.[i] || '—'}`,
            `- explain_ru: ${it.explain_ru || '—'}`);
        const bad = invalid(it);
        if (bad) out.push(`- **код: ${bad}**`);
        if (v) {
            out.push(`- судья: ${[
                field('rule', v.rule, v.rule),
                field('one_correct', v.one_correct, v.one_correct),
                field('distractors_plausible', v.distractors_plausible, v.distractors_plausible),
                field('guessable', v.guessable, !v.guessable),
                field('aux_inside', v.aux_inside, v.aux_inside),
                field('focus_match', v.focus_match, v.focus_match),
                field('explain_ok', v.explain_ok, v.explain_ok),
            ].join(' · ')}`, `- note_ru: ${v.note_ru || '—'}`);
        }
        out.push('');
    });
    return out.join('\n').trimEnd();
}

export const evaluators = [codeChecks, judge];

// Случаи и проблемы — общие для наборов генерации (suite.ts).
export { topicCases as cases, itemProblems as problems } from '../suite';
