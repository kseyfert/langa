// Evals на Langfuse Experiments (architecture.md, «Evals»):
//   npm run eval -- <набор> <область> [--repeat N]
// Случаи — evals/<область>/<набор>.yaml, это источник истины: перед прогоном они
// синхронизируются в датасет Langfuse <область>/<набор>. Прогон — эксперимент на нём,
// итог — в терминал.
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
        throw new Error(`npm run eval -- <${Object.keys(SUITES).join('|')}> <область> [--repeat N]`);
    }
    return { suite: suite as SuiteName, area, repeat };
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

const scoresOf = (results: ExperimentItemResult[]) => {
    const by = new Map<string, number[]>();
    for (const r of results) for (const e of r.evaluations) if (typeof e.value === 'number') by.set(e.name, [...(by.get(e.name) ?? []), e.value]);
    return by;
};

/** Оценки уровня прогона — средние по каждому score. */
const averages = async ({ itemResults }: { itemResults: ExperimentItemResult[] }): Promise<Evaluation[]> =>
    [...scoresOf(itemResults)].map(([name, vs]) => ({ name, value: vs.reduce((a, b) => a + b, 0) / vs.length, comment: `среднее по ${vs.length} заданиям` }));

async function main() {
    const { suite, area, repeat } = args();
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
        const runName = `${v.prompt} · ${v.judge} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
        console.log(`${name}: ${items.length} случаев × ${repeat} — ${runName}`);
        const result = await lf.experiment.run({
            name, runName,
            description: `Генерация ${v.prompt}, судья ${v.judge}`,
            metadata: { prompt_version: v.prompt, judge_version: v.judge, repeat },
            data: Array.from({ length: repeat }, () => items).flat(),
            task: ({ input }) => s.task(input as gapGenerate.Input),
            evaluators: s.evaluators,
            runEvaluators: [averages],
            maxConcurrency: CONCURRENCY,
        });
        await report(result.itemResults, data, result.runEvaluations);
        console.log(`\n${result.experimentUrl ?? '(ссылка не получена)'}`);
    } finally {
        await lf.shutdown();
        await sdk.shutdown();
    }
}

async function report(results: ExperimentItemResult[], data: CaseFile, run: Evaluation[]) {
    console.log('\nСредние');
    for (const e of run) console.log(`  ${e.name.padEnd(22)} ${(e.value as number).toFixed(2)}`);

    const units = new Map((await getUnits(data.cases.map((c) => c.unit_id))).map((u) => [u.id, `${u.number}. ${u.title}`]));
    const bad = results.flatMap((r) => {
        // Не r.input: в результате элемента SDK его не заполняет, хотя тип обещает.
        const input = r.item.input as gapGenerate.Input;
        const problems = r.evaluations.flatMap((e) => (e.metadata as { problems?: gapGenerate.Problem[] } | undefined)?.problems ?? []);
        // Судья упал — его оценок нет вовсе; это тоже проблема задания, а не тишина.
        const noJudge = !('error' in (r.output as gapGenerate.Output)) && !r.evaluations.some((e) => e.name.startsWith('judge_'));
        if (noJudge) problems.push({ item: 0, issue: 'судья не дал оценок (ошибка — выше)' });
        return problems.length ? [{ unit: units.get(input.unit_id) ?? `юнит ${input.unit_id}`, topic: input.topic, problems }] : [];
    });
    console.log(`\nПроблемы: ${bad.length} заданий из ${results.length}`);
    for (const b of bad) {
        console.log(`  ${b.unit} · ${b.topic}`);
        for (const p of b.problems.sort((x, y) => x.item - y.item)) console.log(`    ${p.item ? `пункт ${p.item}` : 'задание'}: ${p.issue}`);
    }
}

main().then(() => process.exit(0), (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
});
