import fs from 'node:fs';
import type { Evaluation, Evaluator, ExperimentItemResult } from '@langfuse/client';
import { getUnit } from '../src/server/catalog';
import type { FreeContent, RephraseContent, TranslateContent } from '../src/server/exercises/types';
import { askJson } from '../src/server/tasks/claude';
import { generate } from '../src/server/tasks/generate';
import { prompts, promptSet, unitValues } from '../src/server/tasks/prompt';
import { FREE_LENGTH } from '../src/server/tasks/types';
import { areaCriteria, controlCases, isControl, itemProblems, suiteFile, topicCases, type Control, type Problem, type Suite } from './suite';

// Общее у наборов генерации открытых типов (rephrase-generate, translate-generate, free-generate;
// architecture.md, «Evals»): настоящая генерация без записи в базу, оценки кодом и судьёй.
// Ошибки бьют по рейтингу косвенно: задание не требует конструкции (лишние обходы), подсказывает
// её (незаслуженный успех) или эталон неверен (проверка на него смотрит).

type OpenType = 'rephrase' | 'translate' | 'free';
type Content = RephraseContent | TranslateContent | FreeContent;

const JUDGE_MODEL = 'claude-opus-5-5';

/** Обычный случай — юнит и тема; контрольный — готовое задание, генерации нет. */
export type Input = { unit_id: number; topic: string } | { unit_id: number; content: Content };
export type Output = { content: Content } | { error: string };

/**
 * Критерий судьи: ключ в ответе, имя score, что не так при false. fields — строковые поля,
 * которые судья заполняет до оценки (рассуждение по шагам); они идут в отчёт.
 */
export type Criterion = { key: string; score: string; issue: string; fields?: string[] };

/** Общие для трёх типов; свои добавляет набор. */
export const COMMON: Criterion[] = [
    { key: 'requires_target', score: 'judge_requires_target', issue: 'естественный ответ обходится без конструкции' },
    { key: 'no_leak', score: 'judge_no_leak', issue: 'задание подсказывает конструкцию' },
    { key: 'reference_ok', score: 'judge_reference', issue: 'эталон неверен' },
    { key: 'focus_match', score: 'judge_focus', issue: 'не по своему пункту focus' },
];

type Verdict = Record<string, { ok: boolean; note_ru: string } & Record<string, unknown>>;

/** Ответ судьи строго по схеме: иначе оценки не ставятся, а не угадываются. */
function verdict(raw: unknown, criteria: Criterion[]): Verdict {
    const o = (raw ?? {}) as Record<string, unknown>;
    for (const c of criteria) {
        const v = (o[c.key] ?? {}) as Record<string, unknown>;
        const fields = (c.fields ?? []).every((f) => typeof v[f] === 'string');
        if (typeof v.ok !== 'boolean' || typeof v.note_ru !== 'string' || !fields) throw new Error(`судья: ${c.key} не по схеме`);
    }
    return o as Verdict;
}

const problem = (issue: string): Problem[] => [{ item: 0, issue }];

/** Эталоны free вне FREE_LENGTH — ученик с таким ответом не прошёл бы parseAnswer. */
const badLength = (refs: string[]) =>
    refs.map((r) => r.trim().length).filter((n) => n < FREE_LENGTH.min || n > FREE_LENGTH.max);

function codeChecks(type: OpenType): Evaluator {
    return async ({ output, expectedOutput }) => {
        // Контрольное задание не генерировалось — проверять в нём генерацию нечего.
        if (isControl(expectedOutput)) return [];
        const o = output as Output;
        if ('error' in o) return { name: 'valid', value: 0, comment: o.error, metadata: { problems: problem(`генерация не удалась: ${o.error}`) } };
        const scores: Evaluation[] = [{ name: 'valid', value: 1, metadata: { problems: [] } }];
        if (type === 'free') {
            const refs = o.content.reference_en;
            const bad = refs.length ? badLength(refs) : [];
            const issue = !refs.length ? 'нет эталона'
                : bad.length ? `эталон ${bad.join(', ')} символов, нужно ${FREE_LENGTH.min}–${FREE_LENGTH.max}` : '';
            scores.push({ name: 'reference_length', value: issue ? 0 : 1, comment: issue || undefined, metadata: { problems: issue ? problem(issue) : [] } });
        }
        return scores;
    };
}

function judge(type: OpenType, file: string, criteria: Criterion[]): Evaluator {
    return async ({ input, output, expectedOutput }) => {
        const o = output as Output;
        if ('error' in o) return [];
        const { unit_id } = input as Input;
        const p = judgePrompts(file);
        const unit = await getUnit(unit_id);
        const raw = await askJson(p.fill('judge', { ...unitValues(unit), task: JSON.stringify(o.content, null, 1) }), JUDGE_MODEL, undefined, {
            call: 'judge', type, promptVersion: p.version, unitId: unit_id, workspaceId: unit.workspaceId,
        });
        const v = verdict(raw, criteria);
        if (isControl(expectedOutput)) {
            // Контрольный случай даёт только control_caught: его вердикты не смешиваются со средними обычных.
            const missed = expectedOutput.expect_fail.filter((k) => v[k].ok);
            return {
                name: 'control_caught', value: missed.length ? 0 : 1,
                comment: missed.length ? `не провалены: ${missed.join(', ')}` : undefined,
                metadata: { verdict: v, missed },
            };
        }
        const scores: Evaluation[] = criteria.map((c) => {
            const { ok, note_ru } = v[c.key];
            return {
                name: c.score, value: ok ? 1 : 0, comment: ok ? undefined : note_ru || undefined,
                metadata: { problems: ok ? [] : problem(note_ru ? `${c.issue} — ${note_ru}` : c.issue) },
            };
        });
        // Вердикт целиком — для отчёта калибровки судьи. Один раз, в первом score.
        scores[0].metadata = { ...(scores[0].metadata as object), verdict: v };
        return scores;
    };
}

/** Поля рассуждения критерия одной строкой — для отчёта и разбора не пойманных контрольных. */
const fieldsOf = (c: Criterion, v: Verdict) =>
    (c.fields ?? []).map((f) => `${f}: ${v[c.key][f] ? `«${v[c.key][f]}»` : '—'}`).join(' · ');

/** Вердикт судьи целиком: у обычного случая — в первом score, у контрольного — в control_caught. */
const verdictOf = (r: ExperimentItemResult) =>
    r.evaluations.map((e) => (e.metadata as { verdict?: Verdict } | undefined)?.verdict).find(Boolean);

/** Не пойманный контрольный случай: чего ждали и что ответил судья по каждому критерию. */
function controlProblems(r: ExperimentItemResult, criteria: Criterion[]): string[] {
    const e = r.evaluations.find((x) => x.name === 'control_caught');
    if (!e) return ['судья не дал оценок (ошибка — выше)'];
    if (e.value === 1) return [];
    const { verdict: v, missed } = e.metadata as { verdict: Verdict; missed: string[] };
    return [
        `не пойман: ждали провала ${(r.item.expectedOutput as Control).expect_fail.join(', ')}, не провалены ${missed.join(', ')}`,
        ...criteria.flatMap((c) => [
            `судья: ${c.key} ${v[c.key].ok}${v[c.key].note_ru ? ` — ${v[c.key].note_ru}` : ''}`,
            ...(c.fields ? [`  ${fieldsOf(c, v)}`] : []),
        ]),
    ];
}

const judgePrompts = (file: string) => promptSet([{ name: 'judge' as const, file, text: fs.readFileSync(file, 'utf8') }]);

const code = (s: string) => `\`${s.replace(/`/g, "'")}\``;

/** Раздел отчёта: задание целиком и вердикт судьи по каждому критерию; проваленные — жирным. */
function reportItem(criteria: Criterion[]) {
    return (r: ExperimentItemResult): string => {
        const o = r.output as Output;
        if ('error' in o) return `Ошибка генерации: ${o.error}`;
        const c = o.content as Record<string, unknown>;
        const show = (k: string) => {
            const v = c[k];
            if (v === undefined) return [];
            return [`- ${k}: ${Array.isArray(v) ? v.map((x) => code(String(x))).join(' · ') || '—' : code(String(v))}`];
        };
        const out = ['instructions_ru', 'source_en', 'source_ru', 'prompt_en', 'reference_en', 'target_note_ru', 'focus'].flatMap(show);
        if ('reference_en' in c && r.evaluations.some((e) => e.name === 'reference_length')) {
            out.push(`- длина эталона: ${(c.reference_en as string[]).map((x) => x.trim().length).join(', ')} (нужно ${FREE_LENGTH.min}–${FREE_LENGTH.max})`);
        }
        const v = verdictOf(r);
        if (!v) return [...out, '', 'Судья не дал оценок.'].join('\n');
        out.push('', ...criteria.map((x) => {
            const { ok, note_ru } = v[x.key];
            const head = ok ? `${x.key}: true` : `**${x.key}: false**`;
            return `- ${head}${note_ru ? ` — ${note_ru}` : ''}${x.fields ? `\n  - ${fieldsOf(x, v)}` : ''}`;
        }));
        return out.join('\n');
    };
}

/** Набор генерации одного открытого типа по области; all — общие и свои критерии судьи, область выбирает из них. */
export const openGenerateSuite = (type: OpenType, all: Criterion[]) => (area: string): Suite => {
    const file = suiteFile(area, `${type}-generate`, 'judge.md');
    const criteria = areaCriteria(area, `${type}-generate`, all);
    return {
        versions: () => ({ prompt: prompts(area, type, ['generate']).version, judge: judgePrompts(file).version }),
        cases: (data, f) => [...topicCases(data), ...controlCases(data, f, criteria.map((c) => c.key))],
        async task(input) {
            const i = input as Input;
            if ('content' in i) return { content: i.content } satisfies Output;
            const { unit_id, topic } = i;
            try {
                // Тема из случая, недавних заданий нет: случай воспроизводим и не зависит от лога.
                const g = await generate(type, unit_id, { topic, recent: [] });
                return { content: g.content as Content } satisfies Output;
            } catch (e) {
                // Сбой генерации — тоже результат прогона (valid 0), а не выпавший случай.
                return { error: e instanceof Error ? e.message : String(e) } satisfies Output;
            }
        },
        evaluators: [codeChecks(type), judge(type, file, criteria)],
        problems: (r) => (isControl(r.item.expectedOutput) ? controlProblems(r, criteria) : itemProblems(r)),
        reportItem: reportItem(criteria),
    };
};
