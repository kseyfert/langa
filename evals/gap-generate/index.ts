import fs from 'node:fs';
import type { Evaluation, Evaluator, ExperimentItemResult } from '@langfuse/client';
import { getUnit } from '../../src/server/catalog';
import type { GapContent } from '../../src/server/exercises/types';
import { askJson } from '../../src/server/tasks/claude';
import { generate } from '../../src/server/tasks/generate';
import { prompts, promptSet, unitValues } from '../../src/server/tasks/prompt';
import { itemProblems, suiteFile, topicCases, type Suite } from '../suite';

// Evals генерации gap (architecture.md, «Evals»): настоящая генерация без записи в базу,
// оценки кодом и судьёй. Ключ gap проверяется локально — неполный ключ, пункт не по юниту
// или угадываемый ответ прямо портят рейтинг.

const ITEMS = 6;
const JUDGE_MODEL = 'claude-opus-5-5';
/** Судья области: content/<область>/gap/evals/generate-judge.md. */
const judgePrompts = (area: string) => {
    const file = suiteFile(area, 'gap-generate', 'judge.md');
    return promptSet([{ name: 'judge' as const, file, text: fs.readFileSync(file, 'utf8') }]);
};

export type Input = { unit_id: number; topic: string };
export type Output = { content: GapContent } | { error: string };
/** Что не так в пункте (item 0 — во всём задании). Лежит в metadata score и идёт в итог прогона. */
export type Problem = { item: number; issue: string };

type Item = GapContent['items'][number];

/** Версии в имени и metadata прогона: сравнивать имеет смысл прогоны с одной версией судьи. */
const versions = (area: string) => ({ prompt: prompts(area, 'gap', ['generate', 'focus-repeat']).version, judge: judgePrompts(area).version });

async function task(input: unknown): Promise<Output> {
    try {
        // Тема из случая, недавних заданий нет: случай воспроизводим и не зависит от лога.
        const { unit_id, topic } = input as Input;
        const g = await generate('gap', unit_id, { topic, recent: [] });
        return { content: g.content as GapContent };
    } catch (e) {
        // Сбой генерации — тоже результат прогона (valid_items 0), а не выпавший случай.
        return { error: e instanceof Error ? e.message : String(e) };
    }
}

/** Доля пунктов, где проверка прошла; что не прошло — в problems. */
function share(name: string, items: Item[], fail: (it: Item, i: number) => string | undefined, comment?: (p: Problem[]) => string): Evaluation {
    const problems = items.flatMap((it, i) => {
        const issue = fail(it, i);
        return issue ? [{ item: i + 1, issue }] : [];
    });
    return { name, value: (items.length - problems.length) / items.length, comment: comment?.(problems), metadata: { problems } };
}

const codeChecks: Evaluator = async ({ output }) => {
    const o = output as Output;
    if ('error' in o) {
        return { name: 'valid_items', value: 0, comment: o.error, metadata: { problems: [{ item: 0, issue: `генерация не удалась: ${o.error}` }] } };
    }
    const items = o.content.items;
    const kept = Math.min(items.length, ITEMS);
    const short = kept < ITEMS ? [{ item: 0, issue: `валидацию прошли ${items.length} пунктов из ${ITEMS}` }] : [];
    return [
        { name: 'valid_items', value: kept / ITEMS, comment: short[0]?.issue, metadata: { problems: short } },
    ];
};

export type Verdict = {
    rule: boolean; missing_answers: string[]; guessable: boolean;
    aux_inside: boolean; focus_match: boolean; explain_ok: boolean; note_ru: string;
};

/** Ответ судьи строго по схеме: иначе оценки не ставятся, а не угадываются. */
function verdicts(raw: unknown, n: number): Verdict[] {
    const list = (raw as { items?: unknown } | null)?.items;
    if (!Array.isArray(list) || list.length !== n) throw new Error(`судья: ожидалось ${n} пунктов`);
    return list.map((v, i) => {
        const o = (v ?? {}) as Record<string, unknown>;
        const bools = ['rule', 'guessable', 'aux_inside', 'focus_match', 'explain_ok'] as const;
        const ok = bools.every((k) => typeof o[k] === 'boolean')
            && Array.isArray(o.missing_answers) && o.missing_answers.every((a) => typeof a === 'string')
            && typeof o.note_ru === 'string';
        if (!ok) throw new Error(`судья: пункт ${i + 1} не по схеме`);
        return o as Verdict;
    });
}

const quote = (xs: string[]) => xs.map((a) => `«${a}»`).join(', ');

/** Критерии судьи: score — доля прошедших пунктов. */
const CRITERIA: [name: string, pass: (v: Verdict) => boolean, issue: (v: Verdict) => string][] = [
    ['judge_rule', (v) => v.rule, () => 'не решается правилом юнита'],
    ['judge_key_complete', (v) => !v.missing_answers.length, (v) => `нет в answers: ${quote(v.missing_answers)}`],
    ['judge_not_guessable', (v) => !v.guessable, () => 'угадывается без правила'],
    ['judge_aux_inside', (v) => v.aux_inside, () => 'вспомогательный глагол вне пропуска'],
    ['judge_focus', (v) => v.focus_match, () => 'не по своему пункту focus'],
    ['judge_explain', (v) => v.explain_ok, () => 'explain_ru неверен'],
];

/** LLM-судья области: один вызов на задание, вердикт по каждому пункту. */
const judge = (area: string): Evaluator => async ({ input, output }) => {
    const o = output as Output;
    if ('error' in o) return [];
    const { unit_id } = input as Input;
    const p = judgePrompts(area);
    const unit = await getUnit(unit_id);
    const { items, focus } = o.content;
    const shown = items.map((it, i) => ({ index: i + 1, text: it.text, answers: it.answers, explain_ru: it.explain_ru, focus: focus?.[i] ?? '' }));
    const raw = await askJson(p.fill('judge', { ...unitValues(unit), items: JSON.stringify(shown, null, 1) }), JUDGE_MODEL, undefined, {
        call: 'judge', type: 'gap', promptVersion: p.version, unitId: unit_id, workspaceId: unit.workspaceId,
    });
    const vs = verdicts(raw, items.length);
    const scores = CRITERIA.map(([name, pass, issue]) => share(name, items, (_, i) => {
        const v = vs[i];
        if (pass(v)) return;
        // Пояснение судьи — к первому проваленному критерию пункта, чтобы не повторять его в каждом.
        const first = CRITERIA.find(([, ok]) => !ok(v))![0] === name;
        return first && v.note_ru ? `${issue(v)} — ${v.note_ru}` : issue(v);
    }, name === 'judge_key_complete' ? (ps) => ps.map((x) => `пункт ${x.item}: ${x.issue}`).join('\n') : undefined));
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
function reportItem(r: ExperimentItemResult): string {
    const o = r.output as Output;
    if ('error' in o) return `Ошибка генерации: ${o.error}`;
    const vs = verdictsOf(r);
    const out = vs ? [] : ['Судья не дал оценок.', ''];
    o.content.items.forEach((it, i) => {
        const v = vs?.[i];
        out.push(`### Пункт ${i + 1}`, '',
            `- text: ${code(it.text)}`,
            `- answers: ${it.answers.map(code).join(', ')}`,
            `- focus: ${o.content.focus?.[i] || '—'}`,
            `- explain_ru: ${it.explain_ru || '—'}`);
        if (v) {
            out.push(`- судья: ${[
                field('rule', v.rule, v.rule),
                field('missing_answers', v.missing_answers, !v.missing_answers.length),
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

/** Набор по области; случаи и проблемы — общие для наборов генерации (suite.ts). */
export const suite = (area: string): Suite => ({
    versions: () => versions(area),
    cases: topicCases,
    task,
    evaluators: [codeChecks, judge(area)],
    problems: itemProblems,
    reportItem,
});
