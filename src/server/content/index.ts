import 'server-only';
import fs from 'node:fs';
import { getWorkspace, listWorkspaces } from '../catalog';
import { prompts } from '../tasks/prompt';
import { typeOf } from '../tasks/registry';
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
 */
export async function checkContent(): Promise<void> {
    const problems: string[] = [];
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
    }
    if (problems.length) throw new Error(`Содержимое областей с ошибками:\n${problems.map((p) => `- ${p}`).join('\n')}`);
}
