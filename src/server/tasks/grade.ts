import 'server-only';
import { catalogForPrompt, getUnit, listUnits } from '../catalog';
import type { OpenAnswer, OpenEvaluation, Verdict } from '../exercises/types';
import { askJson, MODEL_GRADE } from './claude';
import { prompts, unitValues, type Values } from './prompt';
import { TaskError, type Checked } from './types';

// Проверка открытых ответов (rephrase, translate, free). Тексты — grade-system.md и
// grade-user.md в папке каждого типа (specs/exercise-spec.md §7): без оспаривания,
// повторная попытка проверяется как первая, юниты — по id из базы, целевой — с guide.

/** Ответ на открытое задание: непустой текст. */
export function parseOpenAnswer(raw: unknown): OpenAnswer {
    const text = (raw as { text?: unknown } | null)?.text;
    if (typeof text !== 'string' || !text.trim()) throw new TaskError('Ответ пустой');
    return { text: text.trim() };
}

const TARGET_STATUSES = ['correct', 'error', 'partial', 'not_used'] as const;
const OTHER_STATUSES = ['correct', 'error', 'partial'] as const;

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
 * приводятся к допустимым.
 */
function normalize(d: unknown, targetId: number, ids: Set<number>, excluded: Set<number>): OpenEvaluation {
    const o = obj(d);
    const t = obj(o.target_unit);
    const tStatus = oneOf(TARGET_STATUSES, t.status, 'partial');
    const fragment = (x: Raw) => ({ fragment: str(x.fragment), fix: str(x.fix), comment_ru: str(x.comment_ru) });
    // В каталоге промпта исключённых нет, но модель может назвать их id по памяти — такие просто выбрасываем.
    const others = arr(o.other_units).filter((x) => !excluded.has(Number(x.id)));
    const known = (x: Raw) => ids.has(Number(x.id));
    // Модель иногда дублирует ошибку юнита в other_issues — то же место ответа второй раз.
    const reported = [t, ...others.filter(known)].map((x) => str(x.fragment)).filter(Boolean);
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

/**
 * Проверить открытый ответ промптами типа. task — значения для описания задания
 * в grade-user.md, с эталоном.
 */
export async function gradeOpen(type: 'rephrase' | 'translate' | 'free', unitId: number, task: Values, answer: string): Promise<Checked> {
    const p = prompts(type, ['grade-system', 'grade-user']);
    const unit = await getUnit(unitId);
    const book = await listUnits(unit.workspaceId, unit.book);
    // Целевой юнит идёт в промпт отдельно, поэтому каталог от его флага не зависит и одинаков для всей книги — кэшируется.
    const ids = book.filter((u) => !u.excludeAsSide).map((u) => u.id);
    const excluded = new Set(book.filter((u) => u.excludeAsSide).map((u) => u.id));
    const system = p.fill('grade-system', { catalog: await catalogForPrompt(ids) });
    const user = p.fill('grade-user', { ...unitValues(unit), ...task, answer });
    const raw = await askJson(user, MODEL_GRADE, system, {
        call: 'grade', type, promptVersion: p.version, unitId, workspaceId: unit.workspaceId,
    });
    return { evaluation: normalize(raw, unitId, new Set(ids), excluded), model: MODEL_GRADE, promptVersion: p.version };
}
