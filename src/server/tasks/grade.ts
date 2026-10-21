import 'server-only';
import { catalogForPrompt, getUnit, listUnits, unitForPrompt } from '../catalog';
import type { OpenAnswer, OpenEvaluation, Verdict } from '../exercises/types';
import { askJson, MODEL_GRADE } from './claude';
import { TaskError, type Checked } from './types';

// Проверка открытых ответов (rephrase, translate, free) — gradePrompt и GRADE_SHAPE
// прототипа с правками из specs/exercise-spec.md §7: без оспаривания, повторная
// попытка проверяется как первая, юниты — по id из базы, целевой — с guide.
const PROMPT_VERSION = 'grade-v3';

/** Ответ на открытое задание: непустой текст. */
export function parseOpenAnswer(raw: unknown): OpenAnswer {
    const text = (raw as { text?: unknown } | null)?.text;
    if (typeof text !== 'string' || !text.trim()) throw new TaskError('Ответ пустой');
    return { text: text.trim() };
}

const GRADE_SHAPE = `{
 "verdict": "correct_target" | "correct_non_target" | "incorrect",
 "summary_ru": "1–2 sentences",
 "target_unit": {"status": "correct"|"error"|"partial"|"not_used", "score": <0-100 or null if not_used>, "fragment": "exact quote from the answer or empty", "fix": "corrected fragment or empty", "comment_ru": "..."},
 "other_units": [{"id": <catalog id>, "status": "correct"|"error"|"partial", "score": <0-100>, "notable": <true only for a correct use that is advanced or especially well done and worth praising; otherwise false>, "fragment": "exact quote", "fix": "corrected fragment or empty", "comment_ru": "..."}],
 "other_issues": [{"fragment": "...", "fix": "...", "comment_ru": "spelling, vocabulary, meaning, punctuation"}],
 "corrected_answer": "the learner's answer with minimal corrections",
 "natural_version": "how a native speaker would naturally say it"
}`;

/** Неизменная часть: инструкции и каталог книги. Уходит в system и кэшируется. */
function system(catalog: string): string {
    return `You are a strict but fair English grammar examiner for a Russian-speaking learner. The syllabus is a grammar book; its units are the catalog below, one per line as "<id>. <title>".

CATALOG:
${catalog}

How to evaluate:
- The verdict is about the target structure. Errors outside the target unit go to other_units / other_issues and do not change the verdict.
- verdict "correct_target": answers the task and the target structure is used correctly (target_unit.status "correct"), even if there are other errors.
- verdict "correct_non_target": grammatical, answers the task and meaning preserved, but the learner avoided the target structure in a way that is still acceptable English.
- verdict "incorrect": the target structure is used wrongly or only partly right, or the answer does not do the task.
- A grammatical answer that uses a structure wrong for the situation is an error of the target unit: target_unit.status "error", a low score, verdict "incorrect" — not correct_non_target and not other_issues.
- If the target structure is not used and the answer has errors, target_unit.status is "not_used" and the verdict is "incorrect".
- target_unit: how the target structure was handled.
- other_units: list EVERY other catalog unit whose grammar is actually exercised in the answer — tenses, articles, plurals, prepositions, word order, pronouns, determiners, comparatives and so on — whether used correctly or not. Use only catalog ids. Do not list the target unit here.
- Score: 100 flawless; 80–95 correct but slightly unnatural; 50–75 partly right; 0–45 wrong.
- fragment must be quoted exactly from the learner answer.
- other_issues: problems outside the catalog (spelling, word choice, meaning). Empty array if none. Report each problem once: never repeat in other_issues anything already covered by target_unit or other_units.
- Write summary_ru and all comments briefly, in Russian, addressing the learner informally as «ты» (never «вы»).

Reply with only JSON:
${GRADE_SHAPE}`;
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
 * целевой юнит из others выбрасывается, статусы и баллы приводятся к допустимым.
 */
function normalize(d: unknown, targetId: number, ids: Set<number>): OpenEvaluation {
    const o = obj(d);
    const t = obj(o.target_unit);
    const tStatus = oneOf(TARGET_STATUSES, t.status, 'partial');
    const fragment = (x: Raw) => ({ fragment: str(x.fragment), fix: str(x.fix), comment_ru: str(x.comment_ru) });
    const others = arr(o.other_units);
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

/** Проверить открытый ответ. task — описание задания для модели, с эталоном. */
export async function gradeOpen(unitId: number, task: string, answer: string): Promise<Checked> {
    const unit = await getUnit(unitId);
    const book = await listUnits(unit.workspaceId, unit.book);
    const ids = book.map((u) => u.id);
    const user = `TARGET UNIT:
${await unitForPrompt(unitId)}

${task}

LEARNER ANSWER: "${answer}"`;
    const raw = await askJson(user, MODEL_GRADE, system(await catalogForPrompt(ids)));
    return { evaluation: normalize(raw, unitId, new Set(ids)), model: MODEL_GRADE, promptVersion: PROMPT_VERSION };
}
