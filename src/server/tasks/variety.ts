import 'server-only';
import { listExercises } from '../exercises';
import { typeOf } from './registry';

// Данные для разнообразия заданий (все типы): без него генератор по одному
// юниту каждый раз берёт те же глаголы и ситуации — по примеру на пункт guide.
// Тексты правил — в generate.md каждого типа, предложения задания — sentences его определения.

/** Сколько последних заданий юнита показывать модели как «уже было». */
const RECENT = 5;

/** Предложения последних заданий юнита — модели как «уже было». */
export async function recent(unitId: number): Promise<string[]> {
    const list = await listExercises({ unitId, limit: RECENT });
    // Заглушки (model = 'mock') — одно и то же выдуманное предложение, не практика.
    return list.filter((ex) => ex.model !== 'mock').flatMap((ex) => typeOf(ex.type).sentences(ex.content));
}

/** Пункты раздела «## Употребление» из guide. */
function uses(guide: string): string[] {
    const section = guide.split(/^## /m).find((s) => s.startsWith('Употребление')) ?? '';
    return section.split('\n').filter((l) => l.startsWith('- ')).map((l) => l.slice(2).trim());
}

function shuffle<T>(xs: T[]): T[] {
    const a = [...xs];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

/**
 * План фокуса: по пункту «Употребления» на предложение; пишется в content.focus.
 * Пунктов больше нужного — случайные разные; меньше — все, а остаток добирается
 * повторами (repeat — пометка повтора из промпта типа), каждый раз из нового
 * перемешивания, чтобы повторы ложились равномерно. Итог перемешан.
 */
export function plan(guide: string, items: number, repeat?: (point: string) => string): string[] {
    const points = uses(guide);
    if (!points.length) return [];
    const rounds = Math.ceil(items / points.length);
    if (rounds > 1 && !repeat) throw new Error(`Пунктов «Употребления» меньше ${items}, а пометки повтора нет`);
    const picked = Array.from({ length: rounds }, (_, r) => shuffle(points).map((p) => (r ? repeat!(p) : p)))
        .flat()
        .slice(0, items);
    return shuffle(picked);
}
