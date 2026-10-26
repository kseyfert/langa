import type { Evaluator, ExperimentItemResult } from '@langfuse/client';

// Что набор отдаёт общему запуску run.ts (architecture.md, «Evals»). Наборы генерации
// (gap-generate, choice-generate) берут разбор случаев и проблем отсюда, наборы проверки — из grade.ts.

/** Случай из yaml в общем виде: run.ts сверяет юниты с базой и синхронизирует его в датасет. */
export type SuiteCase = {
    id: string;
    unit_id: number;
    input: { unit_id: number };
    expected?: unknown;
    /** Подпись случая в итоге и отчёте после названия юнита. */
    label: string;
    /** Что в случае не заполнено; такой случай в прогон не идёт. */
    pending?: string;
};

export type Units = Map<number, string>;

export type Suite = {
    /** Версии в имени и metadata прогона; judge — только у наборов с судьёй. */
    versions(): { prompt: string; judge?: string };
    cases(data: unknown, file: string): SuiteCase[];
    /** Замечания к случаям для --dry-run и начала прогона: показываются, прогон не останавливают. */
    lint?(cases: SuiteCase[]): Promise<string[]>;
    task(input: unknown): Promise<unknown>;
    evaluators: Evaluator[];
    /** Строки проблем случая для итога в терминале; пусто — случай прошёл. */
    problems(r: ExperimentItemResult, units: Units): string[];
    /** Раздел отчёта по случаю; null — случай в отчёт не идёт. */
    reportItem(r: ExperimentItemResult, units: Units): string | null;
};

/** Случаи наборов генерации: юнит и тема. */
type TopicCase = { id: string; unit_id: number; topic: string };

export function topicCases(data: unknown): SuiteCase[] {
    return (data as { cases: TopicCase[] }).cases.map((c) => ({
        id: c.id, unit_id: c.unit_id, input: { unit_id: c.unit_id, topic: c.topic }, label: c.topic,
    }));
}

/** Что не так в пункте (item 0 — во всём задании). Лежит в metadata score. */
export type Problem = { item: number; issue: string };

/** Проблемы задания генерации — из metadata его оценок; судья упал — тоже проблема, а не тишина. */
export function itemProblems(r: ExperimentItemResult): string[] {
    const problems = r.evaluations.flatMap((e) => (e.metadata as { problems?: Problem[] } | undefined)?.problems ?? []);
    const noJudge = !('error' in (r.output as object)) && !r.evaluations.some((e) => e.name.startsWith('judge_'));
    if (noJudge) problems.push({ item: 0, issue: 'судья не дал оценок (ошибка — выше)' });
    return problems.sort((x, y) => x.item - y.item).map((p) => `${p.item ? `пункт ${p.item}` : 'задание'}: ${p.issue}`);
}
