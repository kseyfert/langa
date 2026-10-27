import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import type { ExerciseType } from '../exercises/types';
import { learnerConfig } from '../learner/config';
import type { Config } from '../learner/model';

// Содержимое области — папка content/<key>/ (key — workspaces.key): workspace.yaml с настройками,
// по папке на тип с промптами и evals (specs/exercise-types.md). Без server-only: настройки
// читают и тесты модели, и evals. Файлы читаются при каждом обращении — правка действует без перезапуска.

/** Путь внутри content/<key>/. Корень — литерал: по нему сборка трассирует только папку content. */
export const contentPath = (key: string, ...parts: string[]) => path.join(process.cwd(), 'content', key, ...parts);

/** Путь для сообщений и отчётов — от корня проекта. */
export const contentFile = (key: string, ...parts: string[]) => ['content', key, ...parts].join('/');

export type WorkspaceSettings = {
    /** Типы области по нарастанию сложности; других планировщик не выдаёт. Пусто — заданий по области нет. */
    types: ExerciseType[];
    /** Темы контекста заданий; пусто — тема не выбирается (у лексики ситуация — в пункте «Употребления»). */
    topics: string[];
    /** Конфиг модели ученика и планировщика: общие умолчания + константы области. */
    config: Config;
};

/** Настройки области из content/<key>/workspace.yaml; файла нет или значения неверны — ошибка с именем файла. */
export function readSettings(key: string): WorkspaceSettings {
    const file = contentFile(key, 'workspace.yaml');
    let raw: { types?: unknown; topics?: unknown; rating?: unknown };
    try {
        raw = parse(fs.readFileSync(contentPath(key, 'workspace.yaml'), 'utf8')) ?? {};
    } catch (e) {
        throw new Error(`${file}: ${e instanceof Error ? e.message : String(e)}`);
    }
    const extra = Object.keys(raw).filter((k) => !['types', 'topics', 'rating'].includes(k));
    const topics = raw.topics;
    // Пустой список допустим: тема не выбирается, промпты области {{topic}} не используют (checkContent).
    const topicsOk = Array.isArray(topics) && topics.every((t) => typeof t === 'string' && t.trim());
    let config: Config;
    try {
        if (extra.length) throw new Error(`лишние разделы ${extra.join(', ')}`);
        if (!topicsOk) throw new Error('topics: нужен список непустых строк');
        config = learnerConfig(raw.types, raw.rating);
    } catch (e) {
        throw new Error(`${file}: ${e instanceof Error ? e.message : String(e)}`);
    }
    return { types: config.TYPES.map((t) => t.type), topics: topics as string[], config };
}
