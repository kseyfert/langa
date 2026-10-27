// Сценарии планировщика — specs/planner.md §8.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ExerciseType, OpenEvaluation } from '../exercises/types';
import { readSettings } from '../content/settings';
import { learnerConfig } from './config';
import { evidenceOf } from './evidence';
import { interval, replay, type Evidence } from './model';
import { consolidateStep, nextExercise, PLANNER_CONFIG, stepRng, typeFor, type PlannerAttempt, type PlannerExercise, type PlannerUnit } from './planner';

// Константы и лестница типов — Grammar In Use: сценарии собраны на её значениях (content/grammar-in-use/workspace.yaml).
const C = readSettings('grammar-in-use').config;

const H = 3_600_000;
const DAY = 24 * H;
const T0 = new Date(2026, 0, 10, 12).getTime();

/** rng для «Закрепления»: 0 — всегда верхняя ступень (вес верхней первый в розыгрыше). */
const TOP = () => 0;

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
                for (const { unitId: u, ev } of evidenceOf({ at: a.at, unitId: ex.unitId, type: ex.type, evaluation: a.evaluation }, () => true, C)) if (u === unitId) evs.push(ev);
            }
            return replay(evs, C);
        },
    };
}

test('1: нет начатых юнитов — нет задания', () => {
    assert.equal(nextExercise([{ id: 5, position: 5, started: false }], [], [], T0, C), null);
});

test('2: новые юниты по порядку книги, по одному gap', () => {
    const log = makeLog();
    const units = started(7, 5, 6);
    let now = T0;
    for (const expected of [5, 6, 7]) {
        const plan = nextExercise(units, log.exercises, log.attempts, now, C);
        assert.deepEqual(plan, { unitId: expected, type: 'gap', tier: 'new' });
        log.solve(plan!.unitId, plan!.type, now, 1);
        now += 2 * 60_000;
    }
});

test('3: единственный кандидат идёт снова, тип по освоению', () => {
    const log = makeLog();
    log.solve(5, 'gap', T0, 1);
    const plan = nextExercise(started(5), log.exercises, log.attempts, T0 + 5 * 60_000, C);
    assert.equal(plan?.unitId, 5);
    assert.equal(plan?.type, typeFor(log.state(5).M, C));
});

test('4: свежий провал уступает, если он был последним; затем его очередь', () => {
    const log = makeLog();
    const now = T0 + 3 * DAY;
    log.solve(8, 'translate', T0, 1);
    log.solve(9, 'translate', T0, 1);
    log.solve(9, 'translate', now - H, 0.2);
    log.solve(8, 'translate', now - 5 * 60_000, 0.2);
    assert.deepEqual(nextExercise(started(8, 9), log.exercises, log.attempts, now, C), { unitId: 9, type: typeFor(log.state(9).M, C), tier: 'failed' });
    log.solve(9, 'gap', now, 1);
    const next = nextExercise(started(8, 9), log.exercises, log.attempts, now + 5 * 60_000, C);
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
        const plan = nextExercise(units, log.exercises, log.attempts, now, C);
        assert.deepEqual(plan, { unitId: expected, type: 'gap', tier: 'new' });
        log.solve(expected, 'gap', now, 1);
        now += 2 * 60_000;
    }
    const plan = nextExercise(units, log.exercises, log.attempts, now, C);
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
    assert.equal(interval(log.state(1), C), 1);
    assert.equal(interval(log.state(2), C), 30);
    const plan = nextExercise(started(1, 2, 3), log.exercises, log.attempts, now, C);
    assert.equal(plan?.unitId, 1);
    assert.equal(plan?.tier, 'due');
});

test('7: побочная ошибка не делает юнит кандидатом, если он не начат', () => {
    const log = makeLog();
    log.solve(6, 'gap', T0, 1);
    log.solve(5, 'free', T0 + H, 0.9, [{ unit: 3, r: 0.2 }]);
    const units = [...started(5, 6), { id: 3, position: 3, started: false }];
    const plan = nextExercise(units, log.exercises, log.attempts, T0 + 2 * H, C);
    assert.equal(plan?.unitId, 6);
});

test('8: побочная ошибка ставит начатый юнит на уровень «Провален»', () => {
    const log = makeLog();
    log.solve(4, 'gap', T0, 1);
    log.solve(19, 'free', T0 + H, 0.9, [{ unit: 4, r: 0.2 }]);
    const plan = nextExercise(started(4, 19), log.exercises, log.attempts, T0 + 2 * H, C);
    assert.equal(plan?.unitId, 4);
    assert.equal(plan?.tier, 'failed');
});

test('9: «верно, но без конструкции» провал не снимает', () => {
    const log = makeLog();
    log.solve(2, 'gap', T0, 1);
    log.solve(1, 'translate', T0 + H, 0.2);
    log.nonTarget(1, 'translate', T0 + 2 * H);
    log.show(2, 'gap', T0 + 3 * H);   // последним был другой юнит
    const plan = nextExercise(started(1, 2), log.exercises, log.attempts, T0 + 4 * H, C);
    assert.equal(plan?.unitId, 1);
    assert.equal(plan?.tier, 'failed');
});

test('10: пропущенное задание — следующим другой юнит', () => {
    const log = makeLog();
    log.show(12, 'gap', T0);
    const plan = nextExercise(started(12, 13), log.exercises, log.attempts, T0 + 60_000, C);
    assert.equal(plan?.unitId, 13);
});

// Юнит один и только что решён — «Закрепление»: верхнюю ступень фиксирует rng TOP.
test('11: освоение перешло 30 после удачного gap — верхняя ступень choice', () => {
    assert.equal(typeFor(29, C), 'gap');
    assert.equal(typeFor(31, C), 'choice');
    const log = makeLog();
    log.solve(5, 'gap', T0, 1);
    assert.ok(log.state(5).M < 30);
    assert.equal(nextExercise(started(5), log.exercises, log.attempts, T0 + H, C, TOP)?.type, 'gap');
    log.solve(5, 'gap', T0 + H, 1);
    assert.ok(log.state(5).M >= 30);
    assert.equal(nextExercise(started(5), log.exercises, log.attempts, T0 + 2 * H, C, TOP)?.type, 'choice');
});

// При difficulty 70 у группы translate/free провал на M ~60 ожидаем (p ≈ 0.3) и стоит мало:
// r 0.2 — минус ~2.4, даже три подряд оставляют M выше 55. Ниже порога опускает только полный провал.
test('12: полностью проваленный translate опускает тип до rephrase', () => {
    assert.equal(typeFor(58, C), 'translate');
    assert.equal(typeFor(52, C), 'rephrase');
    const log = makeLog();
    for (const [d, type] of [[0, 'gap'], [0, 'choice'], [2, 'rephrase'], [6, 'rephrase']] as const) log.solve(5, type, T0 + d * DAY, 1);
    const before = log.state(5).M;
    assert.ok(before >= 55 && before < 65, `M до провала ${before}`);
    log.solve(5, 'translate', T0 + 13 * DAY, 0);
    const after = log.state(5).M;
    assert.ok(after >= 42 && after < 55, `M после провала ${after}`);
    assert.equal(nextExercise(started(5), log.exercises, log.attempts, T0 + 13 * DAY + H, C)?.type, 'rephrase');
});

test('типы — только из области: тип вне её types не выдаётся, порядок и пороги — её', () => {
    const steps = [
        { type: 'gap', fromM: 0, difficulty: 20, levelCap: 50, memoryWeight: 0.2, easy: true },
        { type: 'free', fromM: 40, difficulty: 70, levelCap: 100, memoryWeight: 1, easy: false },
    ];
    const c = learnerConfig(steps);
    assert.equal(typeFor(39, c), 'gap');
    assert.equal(typeFor(95, c), 'free');
    const log = makeLog();
    log.solve(5, 'gap', T0, 1);
    assert.ok(['gap', 'free'].includes(nextExercise(started(5), log.exercises, log.attempts, T0 + H, c)!.type));
});

test('настройки области вне диапазонов rating-model.md §0 — ошибка', () => {
    const gap = { type: 'gap', fromM: 0, difficulty: 20, levelCap: 50, memoryWeight: 0.2, easy: true };
    assert.throws(() => learnerConfig([{ ...gap, levelCap: 10 }]), /levelCap/);
    assert.throws(() => learnerConfig([gap], { FAIL_THRESHOLD: 0.9 }), /FAIL_THRESHOLD/);
    assert.throws(() => learnerConfig([gap], { NO_SUCH: 1 }), /NO_SUCH/);
    assert.throws(() => learnerConfig([{ ...gap, fromM: 10 }]), /fromM/);
});

test('группа translate/free: чередуются — давнее всего показанный тип, никогда не данный — раньше', () => {
    assert.equal(typeFor(60, C), 'translate');   // никому не давали — первый по порядку области
    const log = makeLog();
    log.show(5, 'free', T0);
    assert.equal(typeFor(60, C, log.exercises), 'translate');
    log.show(5, 'translate', T0 + H);
    assert.equal(typeFor(60, C, log.exercises), 'free');
    log.show(5, 'free', T0 + 2 * H);
    assert.equal(typeFor(60, C, log.exercises), 'translate');
    // Задания других юнитов nextExercise в выбор не передаёт.
    log.show(6, 'translate', T0 + 3 * H);
    assert.equal(typeFor(60, C, log.exercises.filter((e) => e.unitId === 5)), 'translate');
    // Одиночный тип — по fromM, задания юнита ни при чём.
    assert.equal(typeFor(50, C, log.exercises), 'rephrase');
});

test('nextExercise чередует группу: free → translate → free', () => {
    const log = makeLog();
    for (const [d, type] of [[0, 'gap'], [0, 'choice'], [2, 'rephrase'], [6, 'rephrase']] as const) log.solve(5, type, T0 + d * DAY, 1);
    log.solve(5, 'free', T0 + 13 * DAY, 1);
    assert.ok(log.state(5).M >= 55, `M ${log.state(5).M}`);
    const seq: string[] = ['free'];
    for (let k = 1; k <= 2; k++) {
        const at = T0 + (13 + k * 15) * DAY;
        const type = nextExercise(started(5), log.exercises, log.attempts, at, C, TOP)!.type;
        seq.push(type);
        log.solve(5, type, at + H, 1);
    }
    assert.deepEqual(seq, ['free', 'translate', 'free']);
});

test('группа с разными константами или с первым типом — ошибка конфига', () => {
    const gap = { type: 'gap', fromM: 0, difficulty: 20, levelCap: 50, memoryWeight: 0.2, easy: true };
    const tr = { type: 'translate', fromM: 55, difficulty: 70, levelCap: 100, memoryWeight: 1, easy: false };
    const fr = { ...tr, type: 'free' };
    assert.doesNotThrow(() => learnerConfig([gap, tr, fr]));
    assert.throws(() => learnerConfig([gap, tr, { ...fr, difficulty: 75 }]), /должны совпадать difficulty/);
    assert.throws(() => learnerConfig([gap, tr, { ...fr, memoryWeight: 0.8 }]), /memoryWeight/);
    assert.throws(() => learnerConfig([gap, { ...tr, fromM: 0 }]), /группа с первым типом/);
    assert.throws(() => learnerConfig([gap, tr, { ...fr, fromM: 50, difficulty: 70 }]), /fromM/);
});

/** Юнит 5 на верхней ступени — группе translate/free: последним решён free. */
function highUnit() {
    const log = makeLog();
    for (const [d, type] of [[0, 'gap'], [0, 'choice'], [2, 'rephrase'], [6, 'rephrase']] as const) log.solve(5, type, T0 + d * DAY, 1);
    log.solve(5, 'free', T0 + 13 * DAY, 1);
    assert.ok(log.state(5).M >= 55, `M ${log.state(5).M}`);
    return log;
}

/** rng, который всегда отдаёт r. При четырёх ступенях и 0.4 веса 1 / 0.4 / 0.16 / 0.064, сумма 1.624. */
const fixed = (r: number) => () => r;

test('«Закрепление»: ступень по весам — группа, rephrase, choice, gap', () => {
    const log = highUnit();
    const at = T0 + 13 * DAY + 2 * H;   // только что решён, срок не пришёл
    const plan = (r: number) => nextExercise(started(5), log.exercises, log.attempts, at, C, fixed(r))!;
    assert.equal(plan(0).tier, 'consolidate');
    // Границы долей: группа < 1/1.624 ≈ 0.616, rephrase < 1.4/1.624 ≈ 0.862, choice < 1.56/1.624 ≈ 0.961.
    assert.equal(plan(0.6).type, 'translate');   // группа; free был последним — значит translate
    assert.equal(plan(0.62).type, 'rephrase');
    assert.equal(plan(0.85).type, 'rephrase');
    assert.equal(plan(0.87).type, 'choice');
    assert.equal(plan(0.95).type, 'choice');
    assert.equal(plan(0.97).type, 'gap');
    assert.equal(plan(0.999).type, 'gap');
});

test('«Закрепление»: доли ступеней — 62 / 25 / 10 / 4%', () => {
    const log = highUnit();
    const at = T0 + 13 * DAY + 2 * H;
    const n = 1000;
    const counts: Record<string, number> = {};
    for (let i = 0; i < n; i++) {
        const t = nextExercise(started(5), log.exercises, log.attempts, at, C, fixed((i + 0.5) / n))!.type;
        counts[t] = (counts[t] ?? 0) + 1;
    }
    assert.deepEqual(
        { group: counts.translate / n, rephrase: counts.rephrase / n, choice: counts.choice / n, gap: counts.gap / n },
        { group: 0.616, rephrase: 0.246, choice: 0.099, gap: 0.039 },
    );
});

test('«Закрепление»: внутри выпавшей группы тип чередуется как раньше', () => {
    const log = highUnit();
    const at = T0 + 13 * DAY + 2 * H;
    assert.equal(nextExercise(started(5), log.exercises, log.attempts, at, C, TOP)!.type, 'translate');
    log.solve(5, 'translate', at, 1);
    assert.equal(nextExercise(started(5), log.exercises, log.attempts, at + 2 * H, C, TOP)!.type, 'free');
});

test('«Новый», «Провален», «Повторение» — всегда верхняя ступень', () => {
    const LOWEST = fixed(0.999);   // в «Закреплении» дало бы gap
    // Повторение: срок пришёл.
    const due = highUnit();
    const dueAt = T0 + 60 * DAY;
    const p1 = nextExercise(started(5), due.exercises, due.attempts, dueAt, C, LOWEST)!;
    assert.equal(p1.tier, 'due');
    assert.equal(p1.type, 'translate');
    // Провален: полный провал translate — верхняя ступень по текущему M, а не нижняя из розыгрыша.
    const failed = highUnit();
    failed.solve(5, 'translate', T0 + 13 * DAY + H, 0);
    const p2 = nextExercise(started(5), failed.exercises, failed.attempts, T0 + 13 * DAY + 3 * H, C, LOWEST)!;
    assert.equal(p2.tier, 'failed');
    assert.equal(p2.type, typeFor(failed.state(5).M, C, failed.exercises));
    assert.notEqual(p2.type, 'gap');
    // Новый: юнит без попыток, M = INITIAL_MASTERY — rng выбор не меняет.
    const fresh = makeLog();
    const p3 = nextExercise(started(7), fresh.exercises, fresh.attempts, T0, C, LOWEST)!;
    assert.equal(p3.tier, 'new');
    assert.equal(p3.type, typeFor(C.INITIAL_MASTERY, C));
});

test('LOWER_TYPE_DECAY 0 — в «Закреплении» всегда верхняя ступень', () => {
    const log = highUnit();
    const at = T0 + 13 * DAY + 2 * H;
    const off = { ...PLANNER_CONFIG, LOWER_TYPE_DECAY: 0 };
    for (const r of [0, 0.5, 0.9, 0.999]) {
        const plan = nextExercise(started(5), log.exercises, log.attempts, at, C, fixed(r), off)!;
        assert.equal(plan.tier, 'consolidate');
        assert.equal(plan.type, 'translate');
    }
});

test('stepRng: на разных сидах доли ступеней — 62 / 25 / 10 / 4%', () => {
    const counts = new Map<number, number>();
    let n = 0;
    for (let unit = 1; unit <= 200; unit++) {
        for (let shown = 0; shown < 100; shown++, n++) {
            const step = consolidateStep(60, C, stepRng(unit, shown), PLANNER_CONFIG.LOWER_TYPE_DECAY);
            counts.set(step, (counts.get(step) ?? 0) + 1);
        }
    }
    // Ступени по fromM: 55 — группа, 42 — rephrase, 30 — choice, 0 — gap.
    for (const [fromM, want] of [[55, 0.616], [42, 0.246], [30, 0.099], [0, 0.039]]) {
        const got = (counts.get(fromM) ?? 0) / n;
        assert.ok(Math.abs(got - want) < 0.015, `ступень ${fromM}: ${got.toFixed(3)}, ждали ${want}`);
    }
});

test('без своего rng одно состояние — один план: заготовка и выдача совпадают; после показа — розыгрыш заново', () => {
    const log = highUnit();
    const at = T0 + 13 * DAY + 2 * H;
    const types = new Set<string>();
    for (let k = 0; k < 40; k++) {
        const a = nextExercise(started(5), log.exercises, log.attempts, at, C)!;
        const b = nextExercise(started(5), log.exercises, log.attempts, at + 60_000, C)!;
        assert.equal(a.tier, 'consolidate');
        assert.deepEqual(a, b);
        types.add(a.type);
        log.show(5, 'gap', at - H + k);   // показанное и пропущенное задание меняет сид (и не меняет уровень)
    }
    assert.ok(types.size > 1, `за 40 состояний выпал только ${[...types]}`);
});
