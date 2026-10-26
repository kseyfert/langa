import type { Evaluation, Evaluator, ExperimentItemResult } from '@langfuse/client';
import { getUnits } from '../src/server/catalog';
import { CONFIG, targetResult } from '../src/server/learner/model';
import { VERDICTS, type OpenEvaluation, type Verdict } from '../src/server/exercises/types';
import { free } from '../src/server/tasks/free';
import { prompts } from '../src/server/tasks/prompt';
import { rephrase } from '../src/server/tasks/rephrase';
import { translate } from '../src/server/tasks/translate';
import type { Task as TaskOf } from '../src/server/tasks/types';
import type { Suite, SuiteCase, Units } from './suite';

// Общее у наборов проверки открытых ответов (rephrase-grade, translate-grade, free-grade;
// architecture.md, «Evals»): тот же путь, что в приложении, — parseAnswer и check, без записи
// в базу. Судьи нет: вердикт, статус целевого юнита и побочные ошибки сравниваются с expect кодом.

type OpenType = 'rephrase' | 'translate' | 'free';
// Через Task, а не типы объектов: у free своя parseAnswer с одним параметром, а зовём единообразно.
const TASKS: { [T in OpenType]: TaskOf<T> } = { rephrase, translate, free };

const TARGET_STATUSES = ['correct', 'error', 'partial', 'not_used'] as const;
type TargetStatus = OpenEvaluation['target']['status'];

/**
 * Ожидание случая. verdict и target — значение или список допустимых. Элемент side_errors —
 * unit_id или список «найден любой из»; side_errors нет — побочные не проверяются, пустой — их быть не должно.
 */
export type Expect = { verdict: Verdict | Verdict[]; target: TargetStatus | TargetStatus[]; side_errors?: (number | number[])[] };

const list = <T>(v: T | T[]): T[] => (Array.isArray(v) ? v : [v]);
/** Все unit_id, которые случай допускает побочными. */
const allowed = (e: Expect) => (e.side_errors ?? []).flatMap(list);

type Task = { id: string; unit_id: number; content: unknown };
type Case = { id: string; task: string; answer: string; expect: Partial<Expect> | null };
type CaseFile = { tasks: Task[]; cases: Case[] };

export type Input = { unit_id: number; content: unknown; answer: string };
export type Output = { evaluation: OpenEvaluation } | { error: string };

type Other = OpenEvaluation['others'][number];
/** Балл побочного как в модели ученика (learner/evidence.ts): без балла — 0.3. */
const sideR = (o: Other) => (o.score != null ? o.score / 100 : 0.3);
/**
 * Побочные с ошибкой, которые снижают рейтинг (rating-model.md §3.1): error / partial с баллом
 * ниже FAIL_THRESHOLD. С баллом от порога в рейтинг не попадают — ни найденными, ни лишними не считаются.
 */
const sideErrors = (ev: OpenEvaluation) => ev.others.filter((o) => o.status !== 'correct' && sideR(o) < CONFIG.FAIL_THRESHOLD);

function cases(data: unknown, file: string): SuiteCase[] {
    const d = data as CaseFile;
    const tasks = new Map(d.tasks.map((t) => [t.id, t]));
    if (tasks.size !== d.tasks.length) throw new Error(`${file}: повторяются id заданий`);
    return d.cases.map((c) => {
        const t = tasks.get(c.task);
        if (!t) throw new Error(`${file}: случай ${c.id} ссылается на неизвестное задание ${c.task}`);
        const e = c.expect ?? {};
        const none = (v: unknown) => v === undefined || (Array.isArray(v) && !v.length);
        const empty = [!c.answer?.trim() && 'answer', none(e.verdict) && 'expect.verdict', none(e.target) && 'expect.target'].filter(Boolean);
        // Заполненное наполовину — тоже незаполненное: в прогон оно не идёт, но и не падает.
        if (!empty.length) {
            const bad = <T>(v: T | T[], ok: readonly T[]) => list(v).find((x) => !ok.includes(x));
            const v = bad(e.verdict!, VERDICTS);
            if (v !== undefined) throw new Error(`${file}: ${c.id}: verdict ${v} — не из ${VERDICTS.join(' / ')}`);
            const ts = bad(e.target!, TARGET_STATUSES);
            if (ts !== undefined) throw new Error(`${file}: ${c.id}: target ${ts} — не из ${TARGET_STATUSES.join(' / ')}`);
            const ids = (x: unknown) => Number.isInteger(x) || (Array.isArray(x) && x.length > 0 && x.every(Number.isInteger));
            if (e.side_errors !== undefined && !(Array.isArray(e.side_errors) && e.side_errors.every(ids))) {
                throw new Error(`${file}: ${c.id}: side_errors — список unit_id или списков unit_id`);
            }
        }
        return {
            id: c.id, unit_id: t.unit_id,
            input: { unit_id: t.unit_id, content: t.content, answer: c.answer ?? '' } satisfies Input,
            expected: e,
            label: c.id,
            pending: empty.length ? `не заполнено: ${empty.join(', ')}` : undefined,
        };
    });
}

/** Ответ, отвергнутый parseAnswer, — ошибка случая (ответ не той формы), а не провал проверки. */
const task = (type: OpenType) => async (input: unknown): Promise<Output> => {
    const { unit_id, content, answer } = input as Input;
    const t = TASKS[type];
    let parsed;
    try {
        parsed = t.parseAnswer({ text: answer }, content as never);
    } catch (e) {
        return { error: `ответ отвергнут: ${e instanceof Error ? e.message : String(e)}` };
    }
    try {
        const c = await t.check(unit_id, content as never, parsed);
        return { evaluation: c.evaluation as OpenEvaluation };
    } catch (e) {
        return { error: `проверка не удалась: ${e instanceof Error ? e.message : String(e)}` };
    }
};

const score = (name: string, ok: boolean): Evaluation => ({ name, value: ok ? 1 : 0 });

/**
 * Целевой юнит засчитан провалом в рейтинге: результат ниже FAIL_THRESHOLD — как в learner/evidence.ts
 * («без конструкции» свидетельства не даёт, not_used — 0, без балла — 100 у correct, иначе 0).
 */
function targetFails(ev: OpenEvaluation): boolean {
    if (ev.verdict === 'correct_non_target') return false;
    const t = ev.target;
    const r = t.status === 'not_used'
        ? targetResult({ kind: 'not_used' })
        : targetResult({ kind: 'used', score: t.score ?? (t.status === 'correct' ? 100 : 0) });
    return r != null && r < CONFIG.FAIL_THRESHOLD;
}

/** Ветка случая — по id (<юнит>-<тип>-<ветка>). */
const isTargetError = (metadata: unknown) => String((metadata as { case?: string } | undefined)?.case ?? '').endsWith('-target-error');

/**
 * Оценки по случаю, 0/1. side_found — только при непустом side_errors, no_false_side — при заданном,
 * target_fail — только в ветке target-error: ошибка в целевой конструкции должна дойти до рейтинга провалом.
 */
const match: Evaluator = async ({ output, expectedOutput, metadata }) => {
    const o = output as Output;
    if ('error' in o) return [];
    const e = expectedOutput as Expect;
    const got = new Set(sideErrors(o.evaluation).map((x) => x.unit_id));
    const ok = new Set(allowed(e));
    return [
        score('verdict_match', list(e.verdict).includes(o.evaluation.verdict)),
        score('target_match', list(e.target).includes(o.evaluation.target.status)),
        ...(e.side_errors?.length ? [score('side_found', e.side_errors.every((x) => list(x).some((id) => got.has(id))))] : []),
        // Лишняя — побочная с ошибкой, которой нет ни в одном элементе списка.
        ...(e.side_errors ? [score('no_false_side', [...got].every((id) => ok.has(id)))] : []),
        ...(isTargetError(metadata) ? [score('target_fail', targetFails(o.evaluation))] : []),
    ];
};

const unit = (units: Units, id: number) => units.get(id) ?? `юнит ${id}`;

function expected(e: Expect, units: Units): string {
    const side = e.side_errors === undefined
        ? 'не проверяются'
        : e.side_errors.length ? e.side_errors.map((x) => list(x).map((id) => unit(units, id)).join(' или ')).join(', ') : 'нет';
    return `${list(e.verdict).join(' / ')} · target ${list(e.target).join(' / ')} · побочные: ${side}`;
}

function got(ev: OpenEvaluation, units: Units): string[] {
    // Все побочные с ошибкой, с баллом; те, что от порога, помечены — в оценки они не идут.
    const side = ev.others.filter((o) => o.status !== 'correct');
    const counted = new Set(sideErrors(ev));
    return [
        `${ev.verdict} · target ${ev.target.status}${ev.target.score === null ? '' : ` (${ev.target.score})`}`,
        side.length
            ? `побочные: ${side.map((o) => `${unit(units, o.unit_id)} — ${o.status} (${o.score}${counted.has(o) ? '' : `, от порога ${CONFIG.FAIL_THRESHOLD * 100} — не в рейтинг`}): «${o.fragment}» → «${o.fix}»`).join('; ')}`
            : 'побочные: нет',
        `summary_ru: ${ev.summary_ru || '—'}`,
    ];
}

const failed = (r: ExperimentItemResult) => r.evaluations.filter((e) => e.value === 0).map((e) => e.name);

/** Несовпавший или упавший случай: ответ, ожидание и что вернула проверка. */
function problems(r: ExperimentItemResult, units: Units): string[] {
    const o = r.output as Output;
    const answer = `ответ: «${(r.item.input as Input).answer}»`;
    if ('error' in o) return [o.error, answer];
    const bad = failed(r);
    if (!bad.length) return [];
    // Не r.expectedOutput: как и input, SDK в результате элемента его может не заполнить.
    return [`не совпало: ${bad.join(', ')}`, answer, `ожидалось: ${expected(r.item.expectedOutput as Expect, units)}`, ...got(o.evaluation, units).map((s) => `проверка: ${s}`)];
}

/** В отчёте — только несовпавшие и упавшие случаи: совпавшие калибровке ничего не дают. */
function reportItem(r: ExperimentItemResult, units: Units): string | null {
    const lines = problems(r, units);
    return lines.length ? lines.map((s) => `- ${s}`).join('\n') : null;
}

/**
 * Замечания к заполненным случаям: ответ, который parseAnswer отвергнет (длина free), и ожидаемые
 * побочные, которых проверка назвать не может, — не из области и книги целевого юнита или
 * exclude_as_side (их нет в каталоге промпта). Показываются, а не исправляются.
 */
const lint = (type: OpenType) => async (cs: SuiteCase[]): Promise<string[]> => {
    const filled = cs.filter((c) => !c.pending);
    const ids = [...new Set(filled.flatMap((c) => [c.unit_id, ...allowed(c.expected as Expect)]))];
    const found = new Map((await getUnits(ids)).map((u) => [u.id, u]));
    return filled.flatMap((c) => {
        const { content, answer } = c.input as Input;
        const out: string[] = [];
        try {
            TASKS[type].parseAnswer({ text: answer }, content as never);
        } catch (e) {
            out.push(`${c.id}: ответ отвергнет parseAnswer — ${e instanceof Error ? e.message : String(e)}`);
        }
        const target = found.get(c.unit_id)!;
        for (const id of allowed(c.expected as Expect)) {
            const u = found.get(id);
            const why = !u ? 'нет в базе'
                : u.workspaceId !== target.workspaceId ? `из области ${u.workspaceId}`
                : u.book !== target.book ? `из книги «${u.book}»`
                : u.excludeAsSide ? 'exclude_as_side — проверка его не называет'
                : id === c.unit_id ? 'это целевой юнит' : '';
            if (why) out.push(`${c.id}: side_errors ${u ? `${u.number}. ${u.title} (${id})` : id} — ${why}`);
        }
        return out;
    });
};

/** Набор проверки открытых ответов одного типа. */
export const gradeSuite = (type: OpenType): Suite => ({
    versions: () => ({ prompt: prompts(type, ['grade-system', 'grade-user']).version }),
    cases,
    lint: lint(type),
    task: task(type),
    evaluators: [match],
    problems,
    reportItem,
});
