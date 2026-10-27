import type { OpenEvaluation, Verdict } from '../exercises/types';

// Ответ модели проверки → OpenEvaluation. Без server-only: чистые функции, их проверяют тесты.

export const TARGET_STATUSES = ['correct', 'error', 'partial', 'not_used'] as const;
export const OTHER_STATUSES = ['correct', 'error', 'partial'] as const;

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const score = (v: unknown) => Math.round(Math.max(0, Math.min(100, Number(v) || 0)));
const oneOf = <T extends string>(list: readonly T[], v: unknown, dflt: T): T => (list.includes(v as T) ? (v as T) : dflt);

type Raw = Record<string, unknown>;

/** Один фрагмент ответа входит в другой — значит, речь об одном и том же месте. */
const overlaps = (a: string, b: string) => {
    const [x, y] = [a.trim().toLowerCase(), b.trim().toLowerCase()];
    return !!x && !!y && (x.includes(y) || y.includes(x));
};
const obj = (v: unknown): Raw => (v && typeof v === 'object' ? (v as Raw) : {});
const arr = (v: unknown): Raw[] => (Array.isArray(v) ? v.map(obj) : []);

/**
 * Вердикт — по целевому юниту (exercise-spec §4.1), не по ответу целиком: побочные ошибки
 * уже снижают рейтинг своих юнитов и видны в правках, второй раз они задание не валят.
 * Модель тут нужна только для «без конструкции»: грамотный обход или провал.
 */
function verdictOf(target: OpenEvaluation['target'], modelVerdict: unknown): Verdict {
    if (target.status === 'correct') return 'correct_target';
    if (target.status !== 'not_used') return 'incorrect';
    return modelVerdict === 'correct_non_target' || modelVerdict === 'correct_target' ? 'correct_non_target' : 'incorrect';
}

/**
 * Ответ модели → OpenEvaluation (exercise-spec §4.1): чужие id уходят в issues,
 * целевой юнит и юниты с exclude_as_side из others выбрасываются, статусы и баллы
 * приводятся к допустимым; issues на месте уже названной ошибки (целевой при error / partial
 * или побочного юнита) выбрасываются.
 */
export function normalize(d: unknown, targetId: number, ids: Set<number>, excluded: Set<number>): OpenEvaluation {
    const o = obj(d);
    const t = obj(o.target_unit);
    const tStatus = oneOf(TARGET_STATUSES, t.status, 'partial');
    const fragment = (x: Raw) => ({ fragment: str(x.fragment), fix: str(x.fix), comment_ru: str(x.comment_ru) });
    // В каталоге промпта исключённых нет, но модель может назвать их id по памяти — такие просто выбрасываем.
    const others = arr(o.other_units).filter((x) => !excluded.has(Number(x.id)));
    const known = (x: Raw) => ids.has(Number(x.id));
    // Модель иногда дублирует ошибку юнита в other_issues — то же место ответа второй раз. Целевой фрагмент
    // считается, только когда в нём ошибка: у correct он часто покрывает почти весь ответ и съел бы настоящие замечания.
    const targetReported = tStatus === 'error' || tStatus === 'partial' ? [t] : [];
    const reported = [...targetReported, ...others.filter(known)].map((x) => str(x.fragment)).filter(Boolean);
    const target = { status: tStatus, score: tStatus === 'not_used' ? null : score(t.score), ...fragment(t) };
    return {
        verdict: verdictOf(target, o.verdict),
        summary_ru: str(o.summary_ru),
        target,
        others: others
            .filter((x) => known(x) && Number(x.id) !== targetId)
            .map((x) => ({ unit_id: Number(x.id), status: oneOf(OTHER_STATUSES, x.status, 'partial'), score: score(x.score), notable: x.notable === true, ...fragment(x) })),
        issues: [
            ...arr(o.other_issues).map(fragment),
            ...others.filter((x) => !known(x) && x.status !== 'correct').map(fragment),
        ].filter((x) => !reported.some((r) => overlaps(r, x.fragment))),
        corrected_answer: str(o.corrected_answer),
        natural_version: str(o.natural_version),
    };
}
