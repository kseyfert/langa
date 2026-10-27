// Чистка ответа модели со схемой (claude.ts, askJson). Без server-only: её проверяют тесты.

/**
 * У всех строк ответа — рекурсивно, в объектах и массивах — обрезаны хвостовые «}» и пробелы.
 * Модель иногда «закрывает» JSON внутри последнего строкового поля верхнего уровня, и ученик видит
 * эту скобку (target_note_ru translate после переноса в конец схемы). Закрывающая фигурная скобка
 * в конце текста задания не бывает осмысленной, поэтому режем во всех строках, не гадая, где последнее поле.
 */
export function trimBraceTails(v: unknown): unknown {
    if (typeof v === 'string') return v.replace(/[\s}]+$/, '');
    if (Array.isArray(v)) return v.map(trimBraceTails);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, trimBraceTails(x)]));
    return v;
}
