// Сценарии планировщика — specs/planner.md §8.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ExerciseType, OpenEvaluation } from '../exercises/types';
import { evidenceOf } from './evidence';
import { interval, replay, type Evidence } from './model';
import { nextExercise, typeFor, type PlannerAttempt, type PlannerExercise, type PlannerUnit } from './planner';

const H = 3_600_000;
const DAY = 24 * H;
const T0 = new Date(2026, 0, 10, 12).getTime();

const started = (...ids: number[]): PlannerUnit[] => ids.map((id) => ({ id, position: id, started: true }));

type Side = { unit: number; r: number };

/** Лог заданий и попыток, как он лежит в базе. */
function makeLog() {
    const exercises: PlannerExercise[] = [];
    const attempts: PlannerAttempt[] = [];
    const show = (unitId: number, type: ExerciseType, at: number) => {
        const ex = { id: exercises.length + 1, unitId, type, createdAt: at };
        exercises.push(ex);
        return ex.id;
    };
    const attempt = (exerciseId: number, at: number, evaluation: PlannerAttempt['evaluation']) =>
        attempts.push({ exerciseId, at, evaluation });
    const open = (verdict: OpenEvaluation['verdict'], status: OpenEvaluation['target']['status'], r: number, others: Side[]): OpenEvaluation => ({
        verdict, summary_ru: '', issues: [], corrected_answer: '', natural_version: '',
        target: { status, score: Math.round(r * 100), fragment: '', fix: '', comment_ru: '' },
        others: others.map((o) => ({
            unit_id: o.unit, status: o.r < 0.5 ? 'error' : 'correct', score: Math.round(o.r * 100), notable: false,
            fragment: '', fix: '', comment_ru: '',
        })),
    });
    return {
        exercises, attempts, show,
        /** Задание показано и решено с результатом r. */
        solve(unitId: number, type: ExerciseType, at: number, r: number, others: Side[] = []) {
            const id = show(unitId, type, at);
            attempt(id, at + 60_000, type === 'gap' || type === 'choice'
                ? { items: [], correct: Math.round(r * 10), total: 10 }
                : open(r >= 0.5 ? 'correct_target' : 'incorrect', r >= 0.5 ? 'correct' : 'error', r, others));
        },
        /** Открытое задание: верно, но без целевой конструкции. */
        nonTarget(unitId: number, type: ExerciseType, at: number) {
            attempt(show(unitId, type, at), at + 60_000, open('correct_non_target', 'not_used', 1, []));
        },
        /** Состояние юнита по логу — для проверки, что сценарий собран как задуман. */
        state(unitId: number) {
            const evs: Evidence[] = [];
            for (const a of attempts) {
                const ex = exercises.find((e) => e.id === a.exerciseId)!;
                for (const { unitId: u, ev } of evidenceOf({ at: a.at, unitId: ex.unitId, type: ex.type, evaluation: a.evaluation })) if (u === unitId) evs.push(ev);
            }
            return replay(evs);
        },
    };
}

test('1: нет начатых юнитов — нет задания', () => {
    assert.equal(nextExercise([{ id: 5, position: 5, started: false }], [], [], T0), null);
});

test('2: новые юниты по порядку книги, по одному gap', () => {
    const log = makeLog();
    const units = started(7, 5, 6);
    let now = T0;
    for (const expected of [5, 6, 7]) {
        const plan = nextExercise(units, log.exercises, log.attempts, now);
        assert.deepEqual(plan, { unitId: expected, type: 'gap', tier: 'new' });
        log.solve(plan!.unitId, plan!.type, now, 1);
        now += 2 * 60_000;
    }
});

test('3: единственный кандидат идёт снова, тип по освоению', () => {
    const log = makeLog();
    log.solve(5, 'gap', T0, 1);
    const plan = nextExercise(started(5), log.exercises, log.attempts, T0 + 5 * 60_000);
    assert.equal(plan?.unitId, 5);
    assert.equal(plan?.type, typeFor(log.state(5).M));
});

test('4: свежий провал уступает, если он был последним; затем его очередь', () => {
    const log = makeLog();
    const now = T0 + 3 * DAY;
    log.solve(8, 'translate', T0, 1);
    log.solve(9, 'translate', T0, 1);
    log.solve(9, 'translate', now - H, 0.2);
    log.solve(8, 'translate', now - 5 * 60_000, 0.2);
    assert.deepEqual(nextExercise(started(8, 9), log.exercises, log.attempts, now), { unitId: 9, type: typeFor(log.state(9).M), tier: 'failed' });
    log.solve(9, 'gap', now, 1);
    const next = nextExercise(started(8, 9), log.exercises, log.attempts, now + 5 * 60_000);
    assert.equal(next?.unitId, 8);
    assert.equal(next?.tier, 'failed');
});

test('5: новые юниты раньше просроченных повторений', () => {
    const log = makeLog();
    const due = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
    for (const u of due) log.solve(u, 'translate', T0 - 10 * DAY + u * 60_000, 1);
    const units = started(1, 2, ...due);
    let now = T0;
    for (const expected of [1, 2]) {
        const plan = nextExercise(units, log.exercises, log.attempts, now);
        assert.deepEqual(plan, { unitId: expected, type: 'gap', tier: 'new' });
        log.solve(expected, 'gap', now, 1);
        now += 2 * 60_000;
    }
    const plan = nextExercise(units, log.exercises, log.attempts, now);
    assert.equal(plan?.tier, 'due');
    assert.ok(due.includes(plan!.unitId));
});

test('6: порядок повторений — по относительной просрочке', () => {
    const log = makeLog();
    // Юнит 2 до ступени «30 дней»: каждый свободный ответ в срок поднимает на ступень.
    for (const d of [0, 2, 6, 13, 27]) log.solve(2, 'free', T0 + d * DAY, 1);
    // Юнит 1: средний первый день — ступень «1 день».
    log.solve(1, 'translate', T0 + 59 * DAY, 0.6);
    // Юнит 3 — последний показанный, не просрочен.
    log.solve(3, 'free', T0 + 61 * DAY, 1);
    const now = T0 + 62 * DAY;
    assert.equal(interval(log.state(1)), 1);
    assert.equal(interval(log.state(2)), 30);
    const plan = nextExercise(started(1, 2, 3), log.exercises, log.attempts, now);
    assert.equal(plan?.unitId, 1);
    assert.equal(plan?.tier, 'due');
});

test('7: побочная ошибка не делает юнит кандидатом, если он не начат', () => {
    const log = makeLog();
    log.solve(6, 'gap', T0, 1);
    log.solve(5, 'free', T0 + H, 0.9, [{ unit: 3, r: 0.2 }]);
    const units = [...started(5, 6), { id: 3, position: 3, started: false }];
    const plan = nextExercise(units, log.exercises, log.attempts, T0 + 2 * H);
    assert.equal(plan?.unitId, 6);
});

test('8: побочная ошибка ставит начатый юнит на уровень «Провален»', () => {
    const log = makeLog();
    log.solve(4, 'gap', T0, 1);
    log.solve(19, 'free', T0 + H, 0.9, [{ unit: 4, r: 0.2 }]);
    const plan = nextExercise(started(4, 19), log.exercises, log.attempts, T0 + 2 * H);
    assert.equal(plan?.unitId, 4);
    assert.equal(plan?.tier, 'failed');
});

test('9: «верно, но без конструкции» провал не снимает', () => {
    const log = makeLog();
    log.solve(2, 'gap', T0, 1);
    log.solve(1, 'translate', T0 + H, 0.2);
    log.nonTarget(1, 'translate', T0 + 2 * H);
    log.show(2, 'gap', T0 + 3 * H);   // последним был другой юнит
    const plan = nextExercise(started(1, 2), log.exercises, log.attempts, T0 + 4 * H);
    assert.equal(plan?.unitId, 1);
    assert.equal(plan?.tier, 'failed');
});

test('10: пропущенное задание — следующим другой юнит', () => {
    const log = makeLog();
    log.show(12, 'gap', T0);
    const plan = nextExercise(started(12, 13), log.exercises, log.attempts, T0 + 60_000);
    assert.equal(plan?.unitId, 13);
});

test('11: освоение перешло 30 после удачного gap — дальше choice', () => {
    assert.equal(typeFor(29), 'gap');
    assert.equal(typeFor(31), 'choice');
    const log = makeLog();
    log.solve(5, 'gap', T0, 1);
    assert.ok(log.state(5).M < 30);
    assert.equal(nextExercise(started(5), log.exercises, log.attempts, T0 + H)?.type, 'gap');
    log.solve(5, 'gap', T0 + H, 1);
    assert.ok(log.state(5).M >= 30);
    assert.equal(nextExercise(started(5), log.exercises, log.attempts, T0 + 2 * H)?.type, 'choice');
});

test('12: проваленный translate опускает тип до rephrase', () => {
    assert.equal(typeFor(58), 'translate');
    assert.equal(typeFor(52), 'rephrase');
    const log = makeLog();
    for (const [d, type] of [[0, 'gap'], [0, 'choice'], [2, 'rephrase'], [6, 'rephrase']] as const) log.solve(5, type, T0 + d * DAY, 1);
    const before = log.state(5).M;
    assert.ok(before >= 55 && before < 65, `M до провала ${before}`);
    log.solve(5, 'translate', T0 + 13 * DAY, 0.2);
    const after = log.state(5).M;
    assert.ok(after >= 42 && after < 55, `M после провала ${after}`);
    assert.equal(nextExercise(started(5), log.exercises, log.attempts, T0 + 13 * DAY + H)?.type, 'rephrase');
});
