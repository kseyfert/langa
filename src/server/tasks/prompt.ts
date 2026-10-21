import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import type { Unit } from '../catalog';

// Тексты промптов — md-файлы в папке типа (exercise-spec §7). Путь от корня проекта,
// а не от модуля: сборка Next переносит модули в .next, а md остаются в src.
// Читаются при каждом вызове — правка файла действует без перезапуска.
const ROOT = path.join(process.cwd(), 'src/server/tasks');

export type Values = Record<string, string>;

type Template = { version: string; body: string };

/** {{name}} — подставляется как есть, даже пустым; {{name?}} — необязательный. */
const PLACEHOLDER = /\{\{(\w+)(\??)\}\}/g;

function read(file: string): Template {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const m = text.match(/^---\nversion: (\S+)\n---\n([\s\S]*?)\n*$/);
    if (!m) throw new Error(`${file}: в начале файла нет версии`);
    return { version: m[1], body: m[2] };
}

/**
 * Подстановка значений. Абзац (текст между пустыми строками), где пуст необязательный
 * плейсхолдер, выбрасывается целиком — так собираются условные части. Пустой обычный
 * плейсхолдер абзац не трогает: иначе вместе с пустым полем молча пропадёт соседний текст.
 * Абзацы делятся до подстановки: пустые строки внутри значения (guide) новых абзацев не порождают.
 */
function fill(file: string, body: string, values: Values): string {
    return body.split('\n\n').flatMap((par) => {
        const found = [...par.matchAll(PLACEHOLDER)].map((m) => ({ name: m[1], optional: m[2] === '?' }));
        // Непереданное значение — ошибка, а не пустая строка: иначе опечатка в md прошла бы незаметно.
        const missing = found.find((p) => !Object.hasOwn(values, p.name));
        if (missing) throw new Error(`${file}: нет значения для {{${missing.name}}}`);
        if (found.some((p) => p.optional && values[p.name] === '')) return [];
        // Один проход: плейсхолдеры внутри подставленного значения (ответ ученика) не раскрываются.
        return [par.replace(PLACEHOLDER, (_, n: string) => values[n])];
    }).join('\n\n');
}

/**
 * Файлы одного вызова модели из папки типа. Версия у них общая — она пишется в задание
 * или попытку; разные версии в одном вызове — ошибка.
 */
export function prompts<N extends string>(type: string, names: readonly [N, ...N[]]) {
    const files = names.map((n) => ({ name: n, file: `${type}/${n}.md`, ...read(`${type}/${n}.md`) }));
    const version = files[0].version;
    const odd = files.find((f) => f.version !== version);
    if (odd) throw new Error(`${odd.file}: версия ${odd.version}, а у ${files[0].file} — ${version}`);
    return {
        version,
        fill(name: N, values: Values): string {
            const f = files.find((x) => x.name === name)!;
            return fill(f.file, f.body, values);
        },
    };
}

/** Значения для описания юнита в промпте. Пока guide пуст — однострочное summary_ru. */
export const unitValues = (u: Unit): Values => ({
    book: u.book,
    section: u.section,
    number: String(u.number ?? '—'),
    title: u.title,
    guide: u.guide.trim() || u.summaryRu,
});

/** Случайная строка в промпт генерации: без неё одинаковые запросы дают одинаковые задания. */
export const seed = () => Math.random().toString(36).slice(2, 8);
