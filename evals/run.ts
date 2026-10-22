// Evals на Langfuse Experiments (architecture.md, «Evals»):
//   npm run eval -- <набор> <область> [--repeat N] [--report]
// При --repeat N у каждого score — ещё средние по повторам и их min/max: разброс — шум модели.
// Случаи — evals/<область>/<набор>.yaml, это источник истины: перед прогоном они
// синхронизируются в датасет Langfuse <область>/<набор>. Прогон — эксперимент на нём,
// итог — в терминал; с --report — ещё подробный отчёт в evals/reports/ (калибровка судьи).
import fs from 'node:fs';
import { LangfuseClient, type Evaluation, type ExperimentItemResult } from '@langfuse/client';
import { LangfuseSpanProcessor } from '@langfuse/otel';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { parse } from 'yaml';
import { getUnits } from '../src/server/catalog';
import * as gapGenerate from './gap-generate';

const SUITES = { 'gap-generate': gapGenerate };
type SuiteName = keyof typeof SUITES;

/** Генерации идут ~20 с; больше параллельных — упрёмся в rate limit. */
const CONCURRENCY = 4;

type Case = { id: string; unit_id: number; topic: string };
type CaseFile = { workspace_id: number; cases: Case[] };

function args() {
    const [suite, area, ...rest] = process.argv.slice(2);
    const r = rest.indexOf('--repeat');
    const repeat = r >= 0 ? Number(rest[r + 1]) : 1;
    if (!(suite in SUITES) || !area || !Number.isInteger(repeat) || repeat < 1) {
        throw new Error(`npm run eval -- <${Object.keys(SUITES).join('|')}> <область> [--repeat N] [--report]`);
    }
    return { suite: suite as SuiteName, area, repeat, report: rest.includes('--report') };
}

async function readCases(area: string, suite: string): Promise<CaseFile> {
    const file = `evals/${area}/${suite}.yaml`;
    const data = parse(fs.readFileSync(file, 'utf8')) as CaseFile;
    const ids = new Set(data.cases.map((c) => c.id));
    if (ids.size !== data.cases.length) throw new Error(`${file}: повторяются id случаев`);
    const units = await getUnits(data.cases.map((c) => c.unit_id));
    for (const c of data.cases) {
        const u = units.find((x) => x.id === c.unit_id);
        if (!u || u.workspaceId !== data.workspace_id) throw new Error(`${file}: юнит ${c.unit_id} (${c.id}) не из области ${data.workspace_id}`);
    }
    return data;
}

/** Датасет повторяет yaml: случаи — upsert по id, пропавшие из файла — в архив, а не удаляются. */
async function sync(lf: LangfuseClient, name: string, data: CaseFile) {
    try {
        await lf.api.datasets.get(name);
    } catch (e) {
        if ((e as { statusCode?: number }).statusCode !== 404) throw e;
        await lf.api.datasets.create({ name, description: `Случаи — evals/${name}.yaml` });
    }
    // id элемента уникален на весь проект Langfuse — отсюда префикс датасета.
    const itemId = (c: Case) => `${name}:${c.id}`;
    const wanted = new Set(data.cases.map(itemId));
    for (const c of data.cases) {
        await lf.dataset.createItem({
            datasetName: name, id: itemId(c), status: 'ACTIVE',
            input: { unit_id: c.unit_id, topic: c.topic }, metadata: { case: c.id, workspace_id: data.workspace_id },
        });
    }
    const existing = await lf.api.datasetItems.list({ datasetName: name, limit: 100 });
    for (const it of existing.data.filter((x) => x.status === 'ACTIVE' && !wanted.has(x.id))) {
        await lf.dataset.createItem({ datasetName: name, id: it.id, status: 'ARCHIVED', input: it.input, metadata: it.metadata });
    }
    const ds = await lf.dataset.get(name);
    // В порядке файла: так итог в терминале читается сверху вниз как yaml.
    const order = data.cases.map(itemId);
    return ds.items.filter((x) => x.status === 'ACTIVE').sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}

/** Номер повтора — прохода по всем случаям; пишется в metadata элемента прогона. */
const repeatOf = (r: ExperimentItemResult) => (r.item.metadata as { repeat?: number } | undefined)?.repeat ?? 1;

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * По каждому score: общее среднее и среднее каждого повтора. Разброс повторов — шум модели:
 * разница версий промпта меньше него — не улучшение.
 */
type Stat = { name: string; mean: number; n: number; byRepeat: number[] };

function stats(results: ExperimentItemResult[], repeat: number): Stat[] {
    const by = new Map<string, { all: number[]; byRepeat: number[][] }>();
    for (const r of results) {
        for (const e of r.evaluations) {
            if (typeof e.value !== 'number') continue;
            const s = by.get(e.name) ?? { all: [], byRepeat: Array.from({ length: repeat }, () => []) };
            s.all.push(e.value);
            s.byRepeat[repeatOf(r) - 1].push(e.value);
            by.set(e.name, s);
        }
    }
    return [...by].map(([name, s]) => ({ name, mean: mean(s.all), n: s.all.length, byRepeat: s.byRepeat.map((xs) => (xs.length ? mean(xs) : NaN)) }));
}

const f2 = (x: number) => (Number.isNaN(x) ? ' —  ' : x.toFixed(2));
/** min и max по повторам; повтор без оценок этого score (NaN) не в счёт. */
const range = (s: Stat) => {
    const xs = s.byRepeat.filter((x) => !Number.isNaN(x));
    return xs.length ? { min: Math.min(...xs), max: Math.max(...xs) } : { min: NaN, max: NaN };
};
const spread = (s: Stat) => `повторы ${s.byRepeat.map(f2).join(' / ')} · min ${f2(range(s).min)} · max ${f2(range(s).max)}`;

/** Оценки уровня прогона: общее среднее по каждому score, при повторах — ещё среднее каждого повтора. */
const averages = (repeat: number) => async ({ itemResults }: { itemResults: ExperimentItemResult[] }): Promise<Evaluation[]> =>
    stats(itemResults, repeat).flatMap((s) => [
        { name: s.name, value: s.mean, comment: repeat > 1 ? spread(s) : `среднее по ${s.n} заданиям` },
        ...(repeat > 1
            ? s.byRepeat.flatMap((value, k) => (Number.isNaN(value) ? [] : [{ name: `${s.name}/repeat-${k + 1}`, value, comment: `среднее повтора ${k + 1}` }]))
            : []),
    ]);

async function main() {
    const { suite, area, repeat, report } = args();
    const s = SUITES[suite];
    const name = `${area}/${suite}`;
    const data = await readCases(area, suite);

    // Скрипт короткоживущий: свой NodeSDK и shutdown в конце, иначе трейсы не успеют уйти.
    const sdk = new NodeSDK({ serviceName: 'langa-evals', spanProcessors: [new LangfuseSpanProcessor()] });
    sdk.start();
    const lf = new LangfuseClient();
    try {
        const items = await sync(lf, name, data);
        const v = s.versions();
        const at = new Date().toISOString().slice(0, 16).replace('T', ' ');
        const runName = `${v.prompt} · ${v.judge} · ${at}`;
        console.log(`${name}: ${items.length} случаев × ${repeat} — ${runName}`);
        const result = await lf.experiment.run({
            name, runName,
            description: `Генерация ${v.prompt}, судья ${v.judge}`,
            metadata: { prompt_version: v.prompt, judge_version: v.judge, repeat },
            // Копия элемента датасета на повтор: id тот же (связь с датасетом), metadata — с номером.
            data: Array.from({ length: repeat }, (_, k) => items.map((it) => ({ ...it, metadata: { ...(it.metadata as object), repeat: k + 1 } }))).flat(),
            task: ({ input }) => s.task(input as gapGenerate.Input),
            evaluators: s.evaluators,
            runEvaluators: [averages(repeat)],
            maxConcurrency: CONCURRENCY,
        });
        const units = await unitNames(data);
        const st = stats(result.itemResults, repeat);
        summary(result.itemResults, units, st, repeat);
        console.log(`\n${result.experimentUrl ?? '(ссылка не получена)'}`);
        if (report) {
            const file = `evals/reports/${suite}_${area}_${at.replace(' ', '_').replace(':', '')}.md`;
            fs.mkdirSync('evals/reports', { recursive: true });
            fs.writeFileSync(file, markdown({ name, runName, versions: v, repeat, url: result.experimentUrl }, result.itemResults, st, units, s.reportItem));
            console.log(`Отчёт: ${file}`);
        }
    } finally {
        await lf.shutdown();
        await sdk.shutdown();
    }
}

type Units = Map<number, string>;

const unitNames = async (data: CaseFile): Promise<Units> =>
    new Map((await getUnits(data.cases.map((c) => c.unit_id))).map((u) => [u.id, `${u.number}. ${u.title}`]));

// Не r.input: в результате элемента SDK его не заполняет, хотя тип обещает.
const inputOf = (r: ExperimentItemResult) => r.item.input as gapGenerate.Input;

function summary(results: ExperimentItemResult[], units: Units, st: Stat[], repeat: number) {
    const W = 22;
    if (repeat > 1) {
        console.log(`\n${'Средние'.padEnd(W + 2)} общее  min    max    ${Array.from({ length: repeat }, (_, k) => `#${k + 1}`.padEnd(6)).join(' ')}`);
        for (const s of st) {
            console.log(`  ${s.name.padEnd(W)} ${f2(s.mean)}   ${f2(range(s).min)}   ${f2(range(s).max)}   ${s.byRepeat.map(f2).join('   ')}`);
        }
    } else {
        console.log('\nСредние');
        for (const s of st) console.log(`  ${s.name.padEnd(W)} ${f2(s.mean)}`);
    }

    const bad = results.flatMap((r) => {
        const input = inputOf(r);
        const problems = r.evaluations.flatMap((e) => (e.metadata as { problems?: gapGenerate.Problem[] } | undefined)?.problems ?? []);
        // Судья упал — его оценок нет вовсе; это тоже проблема задания, а не тишина.
        const noJudge = !('error' in (r.output as gapGenerate.Output)) && !r.evaluations.some((e) => e.name.startsWith('judge_'));
        if (noJudge) problems.push({ item: 0, issue: 'судья не дал оценок (ошибка — выше)' });
        return problems.length ? [{ unit: units.get(input.unit_id) ?? `юнит ${input.unit_id}`, topic: input.topic, at: repeat > 1 ? ` · повтор ${repeatOf(r)}` : '', problems }] : [];
    });
    console.log(`\nПроблемы: ${bad.length} заданий из ${results.length}`);
    for (const b of bad) {
        console.log(`  ${b.unit} · ${b.topic}${b.at}`);
        for (const p of b.problems.sort((x, y) => x.item - y.item)) console.log(`    ${p.item ? `пункт ${p.item}` : 'задание'}: ${p.issue}`);
    }
}

/** Отчёт прогона: шапка с версиями и средними, затем каждое задание целиком — вид пункта задаёт набор. */
function markdown(
    run: { name: string; runName: string; versions: { prompt: string; judge: string }; repeat: number; url?: string },
    results: ExperimentItemResult[],
    st: Stat[],
    units: Units,
    item: (r: ExperimentItemResult) => string,
): string {
    const head = [
        `# ${run.name} — ${run.runName}`, '',
        `- генерация: ${run.versions.prompt}`,
        `- судья: ${run.versions.judge}`,
        `- заданий: ${results.length} (повторов: ${run.repeat})`,
        `- Langfuse: ${run.url ?? '—'}`, '',
        ...(run.repeat > 1
            ? [
                `| score | среднее | min | max | ${Array.from({ length: run.repeat }, (_, k) => `повтор ${k + 1}`).join(' | ')} |`,
                `|---|---|---|---|${'---|'.repeat(run.repeat)}`,
                ...st.map((s) => `| ${s.name} | ${f2(s.mean)} | ${f2(range(s).min)} | ${f2(range(s).max)} | ${s.byRepeat.map(f2).join(' | ')} |`),
            ]
            : ['| score | среднее |', '|---|---|', ...st.map((s) => `| ${s.name} | ${f2(s.mean)} |`)]),
    ];
    const items = results.map((r) => {
        const input = inputOf(r);
        const meta = r.item.metadata as { case?: string } | undefined;
        return [
            `## ${units.get(input.unit_id) ?? `юнит ${input.unit_id}`} · ${input.topic}${run.repeat > 1 ? ` · повтор ${repeatOf(r)}` : ''}`, '',
            `случай \`${meta?.case ?? '—'}\` · трейс \`${r.traceId ?? '—'}\``, '',
            item(r),
        ].join('\n');
    });
    return [head.join('\n'), ...items].join('\n\n').replace(/\n{3,}/g, '\n\n') + '\n';
}

main().then(() => process.exit(0), (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
});
