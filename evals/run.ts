// Evals на Langfuse Experiments (architecture.md, «Evals»):
//   npm run eval -- <набор> <область> [--repeat N] [--report] [--dry-run]
// Всё про набор — в его папке evals/<набор>/: index.ts (случаи, задача и оценщики — suite.ts),
// judge.md у наборов с судьёй, cases/<область>.yaml — случаи, источник истины: перед прогоном
// они синхронизируются в датасет Langfuse <область>/<набор>. Прогон — эксперимент на нём,
// итог — в терминал; с --report — ещё подробный отчёт в evals/reports/ (калибровка).
// При --repeat N у каждого score — ещё средние по повторам и их min/max: разброс — шум модели.
// --dry-run — только прочитать случаи и сверить юниты с базой, без Langfuse и вызовов модели.
// Незаполненные случаи (заготовка) в прогон не идут — их число выводится.
// --controls-only — только контрольные случаи судьи (раздел controls): при подъёме версии судьи.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import { LangfuseClient, type Evaluation, type ExperimentItemResult } from '@langfuse/client';
import { LangfuseSpanProcessor } from '@langfuse/otel';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { parse } from 'yaml';
import { getUnits, listUnits } from '../src/server/catalog';
import * as choiceGenerate from './choice-generate';
import * as freeGenerate from './free-generate';
import * as freeGrade from './free-grade';
import * as gapGenerate from './gap-generate';
import * as rephraseGenerate from './rephrase-generate';
import * as rephraseGrade from './rephrase-grade';
import type { Suite, SuiteCase, Units } from './suite';
import * as translateGenerate from './translate-generate';
import * as translateGrade from './translate-grade';

const SUITES: Record<string, Suite> = {
    'gap-generate': gapGenerate, 'choice-generate': choiceGenerate,
    'rephrase-generate': rephraseGenerate, 'translate-generate': translateGenerate, 'free-generate': freeGenerate,
    'rephrase-grade': rephraseGrade, 'translate-grade': translateGrade, 'free-grade': freeGrade,
};

/**
 * Коммит, на котором идёт прогон, и есть ли незакоммиченные правки в промптах и evals:
 * без них текст версии восстанавливается из git по коммиту. Только запись, не запрет.
 */
function gitState(): { commit: string; dirty: boolean } {
    const run = (cmd: string) => execSync(cmd, { encoding: 'utf8' }).trim();
    return { commit: run('git rev-parse HEAD'), dirty: run('git status --porcelain -- src/server/tasks evals') !== '' };
}

/** Генерации идут ~20 с; больше параллельных — упрёмся в rate limit. */
const CONCURRENCY = 4;

type CaseFile = { workspace_id: number; cases: SuiteCase[] };

function args() {
    const [suite, area, ...rest] = process.argv.slice(2);
    const r = rest.indexOf('--repeat');
    const repeat = r >= 0 ? Number(rest[r + 1]) : 1;
    if (!(suite in SUITES) || !area || !Number.isInteger(repeat) || repeat < 1) {
        throw new Error(`npm run eval -- <${Object.keys(SUITES).join('|')}> <область> [--repeat N] [--report] [--dry-run] [--controls-only]`);
    }
    return { suite, area, repeat, report: rest.includes('--report'), dryRun: rest.includes('--dry-run'), controlsOnly: rest.includes('--controls-only') };
}

const casesFile = (suite: string, area: string) => `evals/${suite}/cases/${area}.yaml`;

async function readCases(area: string, suite: string): Promise<CaseFile> {
    const file = casesFile(suite, area);
    if (!fs.existsSync(file)) throw new Error(`Нет случаев: ${file}`);
    const raw = parse(fs.readFileSync(file, 'utf8')) as { workspace_id: number };
    const cases = SUITES[suite].cases(raw, file);
    const ids = new Set(cases.map((c) => c.id));
    if (ids.size !== cases.length) throw new Error(`${file}: повторяются id случаев`);
    const units = await getUnits([...new Set(cases.map((c) => c.unit_id))]);
    for (const c of cases) {
        const u = units.find((x) => x.id === c.unit_id);
        if (!u || u.workspaceId !== raw.workspace_id) throw new Error(`${file}: юнит ${c.unit_id} (${c.id}) не из области ${raw.workspace_id}`);
    }
    return { workspace_id: raw.workspace_id, cases };
}

/** Датасет повторяет yaml: случаи — upsert по id, пропавшие из файла — в архив, а не удаляются. */
async function sync(lf: LangfuseClient, name: string, file: string, data: CaseFile) {
    try {
        await lf.api.datasets.get(name);
    } catch (e) {
        if ((e as { statusCode?: number }).statusCode !== 404) throw e;
        await lf.api.datasets.create({ name, description: `Случаи — ${file}` });
    }
    // id элемента уникален на весь проект Langfuse — отсюда префикс датасета.
    const itemId = (c: SuiteCase) => `${name}:${c.id}`;
    const wanted = new Set(data.cases.map(itemId));
    for (const c of data.cases) {
        await lf.dataset.createItem({
            datasetName: name, id: itemId(c), status: 'ACTIVE',
            input: c.input, expectedOutput: c.expected,
            metadata: { case: c.id, label: c.label, workspace_id: data.workspace_id, ...(c.control ? { control: true } : {}) },
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
const isControl = (meta: unknown) => (meta as { control?: boolean } | undefined)?.control === true;

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
    const { suite, area, repeat, report, dryRun, controlsOnly } = args();
    const s = SUITES[suite];
    const name = `${area}/${suite}`;
    const all = await readCases(area, suite);
    const pending = all.cases.filter((c) => c.pending);
    const data = { ...all, cases: all.cases.filter((c) => !c.pending) };
    const warnings = (await s.lint?.(all.cases)) ?? [];
    const warn = () => {
        if (!warnings.length) return;
        console.log(`\nЗамечания к случаям: ${warnings.length}`);
        for (const w of warnings) console.log(`  ${w}`);
    };
    if (dryRun) {
        const units = await unitNames(all.workspace_id);
        console.log(`${casesFile(suite, area)} → датасет ${name}: ${all.cases.length} случаев, юниты из области ${all.workspace_id}`);
        for (const c of all.cases) console.log(`  ${c.id.padEnd(28)} ${units.get(c.unit_id)} · ${c.label}${c.pending ? ` — ${c.pending}` : ''}`);
        if (pending.length) console.log(`\nНе заполнено: ${pending.length} из ${all.cases.length} — в прогон не пойдут`);
        else console.log(`\nВсе ${all.cases.length} случаев заполнены`);
        warn();
        return;
    }
    if (!data.cases.length) throw new Error(`${casesFile(suite, area)}: ни одного заполненного случая (не заполнено ${pending.length})`);
    if (pending.length) console.log(`Не заполнено: ${pending.length} из ${all.cases.length} — в прогон не идут`);
    warn();

    // Скрипт короткоживущий: свой NodeSDK и shutdown в конце, иначе трейсы не успеют уйти.
    const sdk = new NodeSDK({ serviceName: 'langa-evals', spanProcessors: [new LangfuseSpanProcessor()] });
    sdk.start();
    const lf = new LangfuseClient();
    try {
        // Синхронизируются все случаи, иначе пропущенные ушли бы в архив; в прогон — только нужные.
        const synced = await sync(lf, name, casesFile(suite, area), data);
        const items = controlsOnly ? synced.filter((it) => isControl(it.metadata)) : synced;
        if (!items.length) throw new Error(`${casesFile(suite, area)}: нет контрольных случаев`);
        const v = s.versions();
        const git = gitState();
        const at = new Date().toISOString().slice(0, 16).replace('T', ' ');
        const runName = [v.prompt, v.judge, at].filter(Boolean).join(' · ');
        console.log(`${name}: ${items.length} случаев × ${repeat} — ${runName}`);
        const result = await lf.experiment.run({
            name, runName,
            description: v.judge ? `Генерация ${v.prompt}, судья ${v.judge}` : `Проверка ${v.prompt}`,
            // repeats, а не repeat: metadata прогона SDK сливает поверх metadata элемента, и номер повтора затирался бы числом повторов.
            metadata: { prompt_version: v.prompt, judge_version: v.judge ?? null, repeats: repeat, commit: git.commit, dirty: git.dirty },
            // Копия элемента датасета на повтор: id тот же (связь с датасетом), metadata — с номером.
            data: Array.from({ length: repeat }, (_, k) => items.map((it) => ({ ...it, metadata: { ...(it.metadata as object), repeat: k + 1 } }))).flat(),
            task: ({ input }) => s.task(input),
            evaluators: s.evaluators,
            runEvaluators: [averages(repeat)],
            maxConcurrency: CONCURRENCY,
        });
        const units = await unitNames(data.workspace_id);
        const st = stats(result.itemResults.filter((r) => !isControl(r.item.metadata)), repeat);
        const ctl = controlSummary(s, result.itemResults, units, repeat);
        summary(s, result.itemResults.filter((r) => !isControl(r.item.metadata)), units, st, repeat);
        if (ctl.length) console.log(`\n${ctl.join('\n')}`);
        console.log(`\n${result.experimentUrl ?? '(ссылка не получена)'}`);
        if (report) {
            // Имя — с точностью до минуты; два прогона в одну минуту не должны затирать отчёт друг друга.
            const base = `evals/reports/${suite}_${area}_${at.replace(' ', '_').replace(':', '')}`;
            let file = `${base}.md`;
            for (let k = 2; fs.existsSync(file); k++) file = `${base}_${k}.md`;
            fs.mkdirSync('evals/reports', { recursive: true });
            fs.writeFileSync(file, markdown({ name, runName, versions: v, repeat, url: result.experimentUrl, git, controls: ctl }, result.itemResults, st, units, (r) => s.reportItem(r, units)));
            console.log(`Отчёт: ${file}`);
        }
    } finally {
        await lf.shutdown();
        await sdk.shutdown();
    }
}

/** Названия всех юнитов области: проверка открытых ответов называет побочные юниты по id. */
const unitNames = async (workspaceId: number): Promise<Units> =>
    new Map((await listUnits(workspaceId)).map((u) => [u.id, `${u.number}. ${u.title}`]));

// Не r.input: в результате элемента SDK его не заполняет, хотя тип обещает.
const unitOf = (r: ExperimentItemResult) => (r.item.input as { unit_id: number }).unit_id;
const labelOf = (r: ExperimentItemResult) => (r.item.metadata as { label?: string } | undefined)?.label ?? '—';

/**
 * Контрольные случаи — отдельно от средних обычных: сколько поймано и, по каждому не пойманному,
 * что ответил судья. Пусто, если контрольных в прогоне нет.
 */
function controlSummary(s: Suite, results: ExperimentItemResult[], units: Units, repeat: number): string[] {
    const ctl = results.filter((r) => isControl(r.item.metadata));
    if (!ctl.length) return [];
    const caught = ctl.filter((r) => r.evaluations.some((e) => e.name === 'control_caught' && e.value === 1)).length;
    const out = [`Контрольные случаи: пойманы ${caught} из ${ctl.length}`];
    for (const r of ctl) {
        const lines = s.problems(r, units);
        if (!lines.length) continue;
        const meta = r.item.metadata as { case?: string };
        out.push(`  ${meta.case} · ${units.get(unitOf(r)) ?? `юнит ${unitOf(r)}`}${repeat > 1 ? ` · повтор ${repeatOf(r)}` : ''}`, ...lines.map((l) => `    ${l}`));
    }
    return out;
}

function summary(s: Suite, results: ExperimentItemResult[], units: Units, st: Stat[], repeat: number) {
    if (!results.length) return;
    const W = 22;
    if (repeat > 1) {
        console.log(`\n${'Средние'.padEnd(W + 2)} общее  min    max    ${Array.from({ length: repeat }, (_, k) => `#${k + 1}`.padEnd(6)).join(' ')}`);
        for (const x of st) {
            console.log(`  ${x.name.padEnd(W)} ${f2(x.mean)}   ${f2(range(x).min)}   ${f2(range(x).max)}   ${x.byRepeat.map(f2).join('   ')}`);
        }
    } else {
        console.log('\nСредние');
        for (const x of st) console.log(`  ${x.name.padEnd(W)} ${f2(x.mean)}`);
    }

    const bad = results.flatMap((r) => {
        const problems = s.problems(r, units);
        return problems.length ? [{ unit: units.get(unitOf(r)) ?? `юнит ${unitOf(r)}`, label: labelOf(r), at: repeat > 1 ? ` · повтор ${repeatOf(r)}` : '', problems }] : [];
    });
    console.log(`\nПроблемы: ${bad.length} из ${results.length}`);
    for (const b of bad) {
        console.log(`  ${b.unit} · ${b.label}${b.at}`);
        for (const p of b.problems) console.log(`    ${p}`);
    }
}

/** Отчёт прогона: шапка с версиями и средними, затем каждое задание целиком — вид пункта задаёт набор. */
function markdown(
    run: {
        name: string; runName: string; versions: { prompt: string; judge?: string }; repeat: number; url?: string;
        git: { commit: string; dirty: boolean }; controls: string[];
    },
    results: ExperimentItemResult[],
    st: Stat[],
    units: Units,
    item: (r: ExperimentItemResult) => string | null,
): string {
    const head = [
        `# ${run.name} — ${run.runName}`, '',
        ...(run.versions.judge
            ? [`- генерация: ${run.versions.prompt}`, `- судья: ${run.versions.judge}`]
            : [`- проверка: ${run.versions.prompt}`]),
        `- случаев: ${results.length} (повторов: ${run.repeat})`,
        `- коммит: ${run.git.commit.slice(0, 7)}${run.git.dirty ? ' + незакоммиченные изменения в src/server/tasks или evals — текст версий из git не восстанавливается' : ''}`,
        `- Langfuse: ${run.url ?? '—'}`, '',
        // Без обычных случаев (--controls-only) таблицы средних нет.
        ...(!st.length ? [] : run.repeat > 1
            ? [
                `| score | среднее | min | max | ${Array.from({ length: run.repeat }, (_, k) => `повтор ${k + 1}`).join(' | ')} |`,
                `|---|---|---|---|${'---|'.repeat(run.repeat)}`,
                ...st.map((s) => `| ${s.name} | ${f2(s.mean)} | ${f2(range(s).min)} | ${f2(range(s).max)} | ${s.byRepeat.map(f2).join(' | ')} |`),
            ]
            : ['| score | среднее |', '|---|---|', ...st.map((s) => `| ${s.name} | ${f2(s.mean)} |`)]),
        ...(run.controls.length ? ['', '```', ...run.controls, '```'] : []),
    ];
    const items = results.flatMap((r) => {
        const body = item(r);
        if (body === null) return [];
        const meta = r.item.metadata as { case?: string } | undefined;
        return [[
            `## ${units.get(unitOf(r)) ?? `юнит ${unitOf(r)}`} · ${labelOf(r)}${run.repeat > 1 ? ` · повтор ${repeatOf(r)}` : ''}`, '',
            `случай \`${meta?.case ?? '—'}\` · трейс \`${r.traceId ?? '—'}\``, '',
            body,
        ].join('\n')];
    });
    return [head.join('\n'), ...items].join('\n\n').replace(/\n{3,}/g, '\n\n') + '\n';
}

main().then(() => process.exit(0), (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
});
