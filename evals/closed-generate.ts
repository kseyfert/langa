import fs from 'node:fs';
import type { Evaluation, Evaluator, ExperimentItemResult } from '@langfuse/client';
import { getUnit } from '../src/server/catalog';
import type { ChoiceContent, GapContent } from '../src/server/exercises/types';
import { askJson } from '../src/server/tasks/claude';
import { generate } from '../src/server/tasks/generate';
import { prompts, promptSet, unitValues } from '../src/server/tasks/prompt';
import { areaCriteria, controlCases, isControl, itemProblems, suiteFile, topicCases, type Control, type Problem, type Suite } from './suite';

// Общее у наборов генерации закрытых типов (gap-generate, choice-generate; architecture.md, «Evals»):
// настоящая генерация без записи в базу, оценки кодом и судьёй по каждому пункту. Ключ проверяется
// локально — неверный ключ, пункт не по юниту или угадываемый ответ прямо портят рейтинг.
// Чем типы различаются — критерии судьи, вид пункта для судьи и отчёта, проверка пункта кодом.

const ITEMS = 6;
const JUDGE_MODEL = 'claude-opus-5-5';

type ClosedType = 'gap' | 'choice';
type Content = GapContent | ChoiceContent;

/** Обычный случай — юнит и тема; контрольный — готовое задание (можно из одного пункта), генерации нет. */
export type Input = { unit_id: number; topic: string } | { unit_id: number; content: Content };
export type Output = { content: Content } | { error: string };

/** Вердикт судьи по пункту: поля критериев и note_ru. */
export type ItemVerdict = Record<string, unknown> & { note_ru: string };

/**
 * Критерий судьи: key — имя в criteria области и в expect_fail контрольных; score — имя оценки
 * (доля прошедших пунктов); field — поле ответа судьи по пункту, boolean или, при list, список строк.
 * keyList — в comment оценки все проблемы по пунктам (пропущенные варианты ключа).
 */
export type ItemCriterion = {
    key: string; score: string; field: string; list?: boolean;
    pass: (v: ItemVerdict) => boolean;
    issue: (v: ItemVerdict) => string;
    keyList?: boolean;
};

/** Чем закрытый тип отличается от другого. */
export type ClosedSpec<I> = {
    type: ClosedType;
    /** Все критерии судьи типа; область выбирает из них (areaCriteria). */
    criteria: ItemCriterion[];
    /** Пункт для судьи. */
    shown: (it: I, index: number, focus: string) => object;
    /** Строки пункта в отчёте до focus. */
    lines: (it: I) => string[];
    /** Проверка пункта кодом сверх normalize; undefined — пункт в порядке. */
    invalid?: (it: I) => string | undefined;
};

const judgePrompts = (area: string, type: ClosedType) => {
    const file = suiteFile(area, `${type}-generate`, 'judge.md');
    return promptSet([{ name: 'judge' as const, file, text: fs.readFileSync(file, 'utf8') }]);
};

const itemsOf = <I>(c: Content) => c.items as unknown as I[];

/** Ответ судьи строго по схеме: иначе оценки не ставятся, а не угадываются. Проверяются только поля критериев области. */
function verdicts(raw: unknown, n: number, criteria: ItemCriterion[]): ItemVerdict[] {
    const list = (raw as { items?: unknown } | null)?.items;
    if (!Array.isArray(list) || list.length !== n) throw new Error(`судья: ожидалось ${n} пунктов`);
    return list.map((v, i) => {
        const o = (v ?? {}) as Record<string, unknown>;
        const ok = criteria.every((c) => (c.list
            ? Array.isArray(o[c.field]) && (o[c.field] as unknown[]).every((a) => typeof a === 'string')
            : typeof o[c.field] === 'boolean')) && typeof o.note_ru === 'string';
        if (!ok) throw new Error(`судья: пункт ${i + 1} не по схеме`);
        return o as ItemVerdict;
    });
}

/** Доля пунктов, где проверка прошла; что не прошло — в problems. */
function share<I>(name: string, items: I[], fail: (it: I, i: number) => string | undefined, comment?: (p: Problem[]) => string): Evaluation {
    const problems = items.flatMap((it, i) => {
        const issue = fail(it, i);
        return issue ? [{ item: i + 1, issue }] : [];
    });
    return { name, value: (items.length - problems.length) / items.length, comment: comment?.(problems), metadata: { problems } };
}

function codeChecks<I>(spec: ClosedSpec<I>): Evaluator {
    return async ({ output, expectedOutput }) => {
        // Контрольное задание не генерировалось — проверять в нём генерацию нечего.
        if (isControl(expectedOutput)) return [];
        const o = output as Output;
        if ('error' in o) {
            return { name: 'valid_items', value: 0, comment: o.error, metadata: { problems: [{ item: 0, issue: `генерация не удалась: ${o.error}` }] } };
        }
        const all = itemsOf<I>(o.content);
        const items = all.slice(0, ITEMS);
        const problems: Problem[] = items.flatMap((it, i) => {
            const issue = spec.invalid?.(it);
            return issue ? [{ item: i + 1, issue }] : [];
        });
        // Отброшенные normalize пункты не видны по отдельности — только как нехватка.
        if (all.length < ITEMS) problems.push({ item: 0, issue: `валидацию формы прошли ${all.length} пунктов из ${ITEMS}` });
        const valid = items.length - problems.filter((p) => p.item).length;
        return { name: 'valid_items', value: valid / ITEMS, comment: problems.map((p) => p.issue).join('; ') || undefined, metadata: { problems } };
    };
}

/** LLM-судья области: один вызов на задание, вердикт по каждому пункту. */
function judge<I>(spec: ClosedSpec<I>, area: string, criteria: ItemCriterion[]): Evaluator {
    return async ({ input, output, expectedOutput }) => {
        const o = output as Output;
        if ('error' in o) return [];
        const { unit_id } = input as Input;
        const p = judgePrompts(area, spec.type);
        const unit = await getUnit(unit_id);
        const items = itemsOf<I>(o.content);
        const shown = items.map((it, i) => spec.shown(it, i + 1, o.content.focus?.[i] ?? ''));
        const raw = await askJson(p.fill('judge', { ...unitValues(unit), items: JSON.stringify(shown, null, 1) }), JUDGE_MODEL, undefined, {
            call: 'judge', type: spec.type, promptVersion: p.version, unitId: unit_id, workspaceId: unit.workspaceId,
        });
        const vs = verdicts(raw, items.length, criteria);
        if (isControl(expectedOutput)) {
            // Критерий провален, если провален хоть в одном пункте. Контрольный случай даёт только control_caught.
            const missed = expectedOutput.expect_fail.filter((k) => vs.every((v) => criteria.find((c) => c.key === k)!.pass(v)));
            return {
                name: 'control_caught', value: missed.length ? 0 : 1,
                comment: missed.length ? `не провалены: ${missed.join(', ')}` : undefined,
                metadata: { verdicts: vs, missed },
            };
        }
        const scores = criteria.map((c) => share(c.score, items, (_, i) => {
            const v = vs[i];
            if (c.pass(v)) return;
            // Пояснение судьи — к первому проваленному критерию пункта, чтобы не повторять его в каждом.
            const first = criteria.find((x) => !x.pass(v)) === c;
            return first && v.note_ru ? `${c.issue(v)} — ${v.note_ru}` : c.issue(v);
        }, c.keyList ? (ps) => ps.map((x) => `пункт ${x.item}: ${x.issue}`).join('\n') : undefined));
        // Вердикты целиком — для отчёта калибровки судьи. Один раз, в первом score, а не в каждом.
        scores[0].metadata = { ...(scores[0].metadata as object), verdicts: vs };
        return scores;
    };
}

/** Вердикты судьи: у обычного случая — в первом score, у контрольного — в control_caught. */
const verdictsOf = (r: ExperimentItemResult): ItemVerdict[] | undefined =>
    r.evaluations.map((e) => (e.metadata as { verdicts?: ItemVerdict[] } | undefined)?.verdicts).find(Boolean);

export const code = (s: string) => `\`${s.replace(/`/g, "'")}\``;
/** Поле вердикта; проваленное — жирным, чтобы при калибровке взгляд цеплялся за него. */
const field = (name: string, value: unknown, ok: boolean) => (ok ? `${name}: ${JSON.stringify(value)}` : `**${name}: ${JSON.stringify(value)}**`);
const judged = (v: ItemVerdict, criteria: ItemCriterion[]) => criteria.map((c) => field(c.field, v[c.field], c.pass(v))).join(' · ');

/** Не пойманный контрольный случай: чего ждали и что ответил судья по каждому пункту. */
function controlProblems(r: ExperimentItemResult, criteria: ItemCriterion[]): string[] {
    const e = r.evaluations.find((x) => x.name === 'control_caught');
    if (!e) return ['судья не дал оценок (ошибка — выше)'];
    if (e.value === 1) return [];
    const { verdicts: vs, missed } = e.metadata as { verdicts: ItemVerdict[]; missed: string[] };
    return [
        `не пойман: ждали провала ${(r.item.expectedOutput as Control).expect_fail.join(', ')}, не провалены ${missed.join(', ')}`,
        ...vs.map((v, i) => `судья, пункт ${i + 1}: ${judged(v, criteria).replace(/\*\*/g, '')}${v.note_ru ? ` — ${v.note_ru}` : ''}`),
    ];
}

/** Раздел отчёта по заданию: каждый пункт и вердикт судьи по нему целиком. */
function reportItem<I>(spec: ClosedSpec<I>, criteria: ItemCriterion[]) {
    return (r: ExperimentItemResult): string => {
        const o = r.output as Output;
        if ('error' in o) return `Ошибка генерации: ${o.error}`;
        const vs = verdictsOf(r);
        const out = vs ? [] : ['Судья не дал оценок.', ''];
        itemsOf<I>(o.content).forEach((it, i) => {
            const v = vs?.[i];
            out.push(`### Пункт ${i + 1}`, '', ...spec.lines(it),
                `- focus: ${o.content.focus?.[i] || '—'}`,
                `- explain_ru: ${(it as { explain_ru?: string }).explain_ru || '—'}`);
            const bad = spec.invalid?.(it);
            if (bad) out.push(`- **код: ${bad}**`);
            if (v) out.push(`- судья: ${judged(v, criteria)}`, `- note_ru: ${v.note_ru || '—'}`);
            out.push('');
        });
        return out.join('\n').trimEnd();
    };
}

/** Набор генерации закрытого типа по области: критерии судьи — те, что выбрала область. */
export const closedGenerateSuite = <I>(spec: ClosedSpec<I>) => (area: string): Suite => {
    const suite = `${spec.type}-generate`;
    const criteria = areaCriteria(area, suite, spec.criteria);
    return {
        // Версии в имени и metadata прогона: сравнивать имеет смысл прогоны с одной версией судьи.
        versions: () => ({ prompt: prompts(area, spec.type, ['generate', 'focus-repeat']).version, judge: judgePrompts(area, spec.type).version }),
        cases: (data, f) => [...topicCases(data), ...controlCases(data, f, criteria.map((c) => c.key))],
        async task(input) {
            const i = input as Input;
            if ('content' in i) return { content: i.content } satisfies Output;
            try {
                // Тема из случая, недавних заданий нет: случай воспроизводим и не зависит от лога.
                const g = await generate(spec.type, i.unit_id, { topic: i.topic, recent: [] });
                return { content: g.content as Content } satisfies Output;
            } catch (e) {
                // Сбой генерации — тоже результат прогона (valid_items 0), а не выпавший случай.
                return { error: e instanceof Error ? e.message : String(e) } satisfies Output;
            }
        },
        evaluators: [codeChecks(spec), judge(spec, area, criteria)],
        problems: (r) => (isControl(r.item.expectedOutput) ? controlProblems(r, criteria) : itemProblems(r)),
        reportItem: reportItem(spec, criteria),
    };
};
