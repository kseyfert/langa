export type UnitStatus = 'idle' | 'learning' | 'mastered';

/**
 * Статус юнита — для фона строки, карты и счётчиков, одно правило на все места.
 * Юнит без заданий (пустой guide) в работе — сразу освоен: практики по нему не бывает.
 */
export function unitStatus(started: boolean, hasTasks: boolean, mastered: boolean): UnitStatus {
    if (!started) return 'idle';
    return !hasTasks || mastered ? 'mastered' : 'learning';
}
