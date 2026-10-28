import { hasTasks, type Unit } from '@/server/catalog';
import type { UnitRating } from '@/server/learner';
import type { MapSection } from './UnitMap';
import { unitStatus } from './unitStatus';

/**
 * Разделы карты: подряд идущие юниты одной книги и раздела, в порядке position. Юнит другой книги
 * разрывает раздел, как и на странице области. Статус — тот же, что красит строку юнита (unitStatus).
 * Не в UnitMap.tsx: тот — клиентский модуль, а разделы собирает сервер.
 */
export function unitMapSections(units: Unit[], ratings: Map<number, UnitRating>): MapSection[] {
    const sections: MapSection[] = [];
    let prev: Unit | null = null;
    for (const u of units) {
        if (!prev || prev.book !== u.book || prev.section !== u.section) sections.push({ key: u.position, name: u.section, units: [] });
        sections.at(-1)!.units.push({
            id: u.id, number: u.number, title: u.title,
            status: unitStatus(u.started, hasTasks(u), ratings.get(u.id)?.mastered ?? false),
        });
        prev = u;
    }
    return sections;
}
