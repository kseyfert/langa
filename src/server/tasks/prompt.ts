import 'server-only';
import fs from 'node:fs';
import type { Unit } from '../catalog';
import { contentFile, contentPath } from '../content/settings';

// Тексты промптов — md-файлы в папке типа внутри содержимого области: content/<key>/<type>/
// (exercise-spec §7, exercise-types.md). Путь от корня проекта, а не от модуля: сборка Next
// переносит модули в .next, а content остаётся на месте.
// Читаются при каждом вызове — правка файла действует без перезапуска.

export type Values = Record<string, string>;

type Template = { version: string; body: string };

/** {{name}} — подставляется как есть, даже пустым; {{name?}} — необязательный. */
const PLACEHOLDER = /\{\{(\w+)(\??)\}\}/g;

/** file — только для сообщений об ошибке. */
function parse(file: string, text: string): Template {
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
 * Файлы одного вызова модели из папки типа в области key. Версия у них общая — она пишется
 * в задание или попытку; разные версии в одном вызове — ошибка.
 */
export const prompts = <N extends string>(key: string, type: string, names: readonly [N, ...N[]]) => promptSet(names.map((name) => ({
    name,
    file: contentFile(key, type, `${name}.md`),
    text: fs.readFileSync(contentPath(key, type, `${name}.md`), 'utf8'),
})));

/** Набор из уже прочитанных файлов — для промптов не из вызовов приложения (судьи evals). */
export function promptSet<N extends string>(sources: { name: N; file: string; text: string }[]) {
    const files = sources.map((f) => ({ ...f, ...parse(f.file, f.text) }));
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

/** Значения для описания юнита в промпте. Юнитов с пустым guide сюда не доходит — заданий по ним нет. */
export const unitValues = (u: Unit): Values => ({
    book: u.book,
    section: u.section,
    number: String(u.number ?? '—'),
    title: u.title,
    guide: u.guide,
});

/** Случайная строка в промпт генерации: без неё одинаковые запросы дают одинаковые задания. */
export const seed = () => Math.random().toString(36).slice(2, 8);
