import 'server-only';
import fs from 'node:fs';
import { getWorkspace, hasTasks, listUnits, listWorkspaces } from '../catalog';
import { prompts } from '../tasks/prompt';
import { typeOf } from '../tasks/registry';
import { uses } from '../tasks/variety';
import { contentFile, contentPath, readSettings, type WorkspaceSettings } from './settings';

export { contentFile, contentPath, readSettings, type WorkspaceSettings };

export type WorkspaceContent = WorkspaceSettings & { key: string };

/** Настройки области по её id — для юнита: unit.workspaceId. */
export async function workspaceContent(workspaceId: number): Promise<WorkspaceContent> {
    const ws = await getWorkspace(workspaceId);
    if (!ws) throw new Error(`Рабочая область ${workspaceId} не найдена`);
    return { key: ws.key, ...readSettings(ws.key) };
}

/** Файлы промптов вызовов типа: генерация и, если тип проверяется моделью, проверка. */
export function callsOf(type: Parameters<typeof typeOf>[0]): { call: 'generate' | 'grade'; names: [string, ...string[]] }[] {
    const def = typeOf(type);
    return [
        { call: 'generate', names: def.items > 1 ? ['generate', 'focus-repeat'] : ['generate'] },
        ...(def.check.by === 'model' ? [{ call: 'grade' as const, names: ['grade-system', 'grade-user'] as [string, ...string[]] }] : []),
    ];
}

/**
 * Проверка при старте сервера (instrumentation.node.ts): у каждой области из базы есть
 * content/<key>/workspace.yaml с допустимыми значениями, у каждого её типа — нужные md
 * с одной версией на вызов, а имена версий не повторяются между вызовами и областями.
 * Иначе — ошибка со всеми проблемами сразу: сервер не должен стартовать с битым содержимым.
 *
 * Возвращает предупреждения — о guide юнитов, с которыми задания выйдут однообразнее (guideWarnings);
 * сервер с ними стартует.
 */
export async function checkContent(): Promise<string[]> {
    const problems: string[] = [];
    const warnings: string[] = [];
    const versions = new Map<string, string>();
    for (const ws of await listWorkspaces()) {
        let settings: WorkspaceSettings;
        try {
            settings = readSettings(ws.key);
        } catch (e) {
            problems.push(fs.existsSync(contentPath(ws.key, 'workspace.yaml'))
                ? (e instanceof Error ? e.message : String(e))
                : `область «${ws.name}» (${ws.id}): нет ${contentFile(ws.key, 'workspace.yaml')}`);
            continue;
        }
        for (const type of settings.types) {
            for (const { call, names } of callsOf(type)) {
                const missing = names.filter((n) => !fs.existsSync(contentPath(ws.key, type, `${n}.md`)));
                if (missing.length) {
                    problems.push(`${contentFile(ws.key, type)}: нет ${missing.map((n) => `${n}.md`).join(', ')}`);
                    continue;
                }
                try {
                    const { version } = prompts(ws.key, type, names);
                    const where = `${ws.key}/${type}/${call}`;
                    const other = versions.get(version);
                    if (other) problems.push(`версия ${version} — и у ${other}, и у ${where}: имена версий уникальны (exercise-spec §7)`);
                    else versions.set(version, where);
                } catch (e) {
                    problems.push(e instanceof Error ? e.message : String(e));
                }
            }
        }
        warnings.push(...await guideWarnings(ws, settings.types));
    }
    if (problems.length) throw new Error(`Содержимое областей с ошибками:\n${problems.map((p) => `- ${p}`).join('\n')}`);
    return warnings;
}

/**
 * Юниты с заданиями (guide не пуст), у которых в guide нет раздела «## Употребление» или в нём
 * меньше пунктов, чем предложений в самом длинном задании области (items, exercise-spec §7):
 * план фокуса берётся из этого раздела, без него задания однообразнее. У области без типов — ничего.
 */
async function guideWarnings(ws: { id: number; name: string }, types: WorkspaceSettings['types']): Promise<string[]> {
    if (!types.length) return [];
    const need = Math.max(...types.map((t) => typeOf(t).items));
    return (await listUnits(ws.id)).filter(hasTasks).flatMap((u) => {
        const points = uses(u.guide);
        if (points && points.length >= need) return [];
        const what = points ? `${points.length} из ${need} пунктов в «## Употребление»` : 'нет раздела «## Употребление»';
        return [`${ws.name}: ${u.number ?? '—'}. ${u.title} — ${what}`];
    });
}
