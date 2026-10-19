// Сценарии модели, зависящие от PROMOTE_MIN_CREDIT — specs/rating-model.md §4.3.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CONFIG, update, type ExerciseType, type UnitState } from './model';

const DAY = 86_400_000;
const T0 = new Date(2026, 0, 10, 12).getTime();

/** Освоение 50, ступень stage, повтор в срок: практика ровно через интервал. */
function day(stage: number, tasks: ExerciseType[]): UnitState {
    let u: UnitState = { M: 50, stage, lastSeen: T0, dueFrom: T0, day: null };
    const at = T0 + CONFIG.LADDER_DAYS[stage] * DAY;
    tasks.forEach((type, i) => (u = update(u, { at: at + i * 60_000, role: 'target', type, r: 1 })));
    return u;
}

test('4.3: один пропуск поднимает ступень 2 → 3', () => {
    assert.equal(day(2, ['gap']).stage, 3);
});

test('4.3: пропуски не поднимают выше EASY_MAX_STAGE', () => {
    assert.equal(day(2, Array(20).fill('gap')).stage, 3);
    assert.equal(day(3, ['gap']).stage, 3);
    assert.equal(day(3, Array(20).fill('gap')).stage, 3);
    assert.equal(day(5, ['gap']).stage, 5);
    assert.equal(day(5, Array(20).fill('gap')).stage, 5);
});

test('4.3: один свободный ответ поднимает на ступень, освоение 67', () => {
    for (const stage of [2, 3, 5]) {
        const u = day(stage, ['free']);
        assert.equal(u.stage, stage + 1);
        assert.equal(Math.round(u.M), 67);
    }
});

test('пропуск с ошибкой — мало практики: ступень та же, интервал заново', () => {
    // 9 из 10: r̄ = 0.9 удачный, но вклад 0.2 · 0.9 = 0.18 < PROMOTE_MIN_CREDIT.
    let u: UnitState = { M: 50, stage: 2, lastSeen: T0, dueFrom: T0, day: null };
    const at = T0 + 4 * DAY;
    u = update(u, { at, role: 'target', type: 'gap', r: 0.9 });
    assert.equal(u.stage, 2);
    assert.equal(u.dueFrom, at);
});
