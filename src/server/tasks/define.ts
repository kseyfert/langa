import type { OpenAnswer } from '../exercises/types';
import { TaskError } from './types';

// Общие детали определений типов (tasks/<type>/index.ts): схемы ответа, разбор ответа модели и ученика.

export const BAD_FORMAT = 'Claude ответил в неожиданном формате. Попробуй ещё раз.';

export const isStr = (v: unknown): v is string => typeof v === 'string';

/** Объект со всеми полями обязательными и без лишних — так требует structured outputs. Порядок полей — порядок в ответе. */
export const object = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
export const text = (description?: string) => ({ type: 'string', ...(description && { description }) });

/**
 * Пункты закрытого задания (gap, choice) — как normalizeEx прототипа: пункты не той формы
 * отбрасываются; ни одного годного — ошибка. План фокуса прорежается вместе с пунктами,
 * чтобы focus[i] по-прежнему описывал items[i].
 */
export function closedContent<Item>(d: unknown, plan: string[], item: (i: unknown) => Item | null) {
    const o = (d ?? {}) as { instructions_ru?: unknown; items?: unknown };
    const all = (Array.isArray(o.items) ? o.items : []).map(item);
    const kept = all.flatMap((it, k) => (it ? [k] : []));
    if (!kept.length) throw new TaskError(BAD_FORMAT);
    return {
        instructions_ru: isStr(o.instructions_ru) ? o.instructions_ru : '',
        items: kept.map((k) => all[k]!),
        focus: kept.map((k) => plan[k] ?? ''),
    };
}

/** Ответ на открытое задание: непустой текст. */
export function parseOpenAnswer(raw: unknown): OpenAnswer {
    const text = (raw as { text?: unknown } | null)?.text;
    if (typeof text !== 'string' || !text.trim()) throw new TaskError('Ответ пустой');
    return { text: text.trim() };
}
