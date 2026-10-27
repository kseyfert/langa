import 'server-only';
import { catalogForPrompt, getUnit, getWorkspace, listUnits } from '../catalog';
import type { Answer, ClosedEvaluation, ExerciseContent, ExerciseType, OpenAnswer } from '../exercises/types';
import { askJson, MODEL_GRADE, type JsonSchema } from './claude';
import { object, text } from './define';
import { normalize, OTHER_STATUSES, TARGET_STATUSES } from './evaluation';
import { prompts, unitValues, type Values } from './prompt';
import type { Checked, TaskType } from './types';

// Проверка ответа — общая для всех типов, вид выбирает check.by определения типа.
// По ключу (gap, choice) — локально. Моделью (rephrase, translate, free) — тексты grade-system.md и
// grade-user.md в папке каждого типа (specs/exercise-spec.md §7): без оспаривания,
// повторная попытка проверяется как первая, юниты — по id из базы, целевой — с guide.

/**
 * Схема ответа проверки — общая у трёх типов (формат задаёт код, не промпт). Описания полей —
 * бывший хвост «Reply with only JSON» grade-system.md. Диапазон баллов схема не держит — его держит normalize.
 */
const SCHEMA: JsonSchema = object({
    verdict: { type: 'string', enum: ['correct_target', 'correct_non_target', 'incorrect'] },
    summary_ru: text('1–2 sentences'),
    target_unit: object({
        status: { type: 'string', enum: [...TARGET_STATUSES] },
        score: { anyOf: [{ type: 'integer' }, { type: 'null' }], description: '0-100 or null if not_used' },
        fragment: text('exact quote from the answer or empty'),
        fix: text('corrected fragment or empty'),
        comment_ru: text(),
    }),
    other_units: {
        type: 'array',
        items: object({
            id: { type: 'integer', description: 'catalog id' },
            status: { type: 'string', enum: [...OTHER_STATUSES] },
            score: { type: 'integer', description: '0-100' },
            notable: { type: 'boolean', description: 'true only for a correct use that is advanced or especially well done and worth praising; otherwise false' },
            fragment: text('exact quote'),
            fix: text('corrected fragment or empty'),
            comment_ru: text(),
        }),
    },
    other_issues: { type: 'array', items: object({ fragment: text(), fix: text(), comment_ru: text('spelling, vocabulary, meaning, punctuation') }) },
    corrected_answer: text("the learner's answer with minimal corrections"),
    natural_version: text('how a native speaker would naturally say it'),
});

/**
 * Проверить открытый ответ промптами типа. task — значения для описания задания
 * в grade-user.md, с эталоном.
 */
async function gradeOpen(type: ExerciseType, unitId: number, task: Values, answer: string): Promise<Checked> {
    const unit = await getUnit(unitId);
    const ws = await getWorkspace(unit.workspaceId);
    const p = prompts(ws!.key, type, ['grade-system', 'grade-user']);
    const book = await listUnits(unit.workspaceId, unit.book);
    // Целевой юнит идёт в промпт отдельно, поэтому каталог от его флага не зависит и одинаков для всей книги — кэшируется.
    const ids = book.filter((u) => !u.excludeAsSide).map((u) => u.id);
    const excluded = new Set(book.filter((u) => u.excludeAsSide).map((u) => u.id));
    const system = p.fill('grade-system', { catalog: await catalogForPrompt(ids) });
    const user = p.fill('grade-user', { ...unitValues(unit), ...task, answer });
    const raw = await askJson(user, MODEL_GRADE, system, {
        call: 'grade', type, promptVersion: p.version, unitId, workspaceId: unit.workspaceId,
    }, SCHEMA);
    return { evaluation: normalize(raw, unitId, new Set(ids), excluded), model: MODEL_GRADE, promptVersion: p.version };
}

/** Проверить разобранный ответ (parseAnswer типа) так, как велит тип. */
export async function grade(def: TaskType<ExerciseType>, unitId: number, content: ExerciseContent, answer: Answer): Promise<Checked> {
    if (def.check.by === 'model') return gradeOpen(def.type, unitId, def.check.task(content), (answer as OpenAnswer).text);
    // Проверка по ключу бывает только у типов с ответом-списком: по ответу на пункт.
    const given = answer as ClosedEvaluation['items'][number]['given'][];
    const items = def.check.score(content, answer).map((correct, index) => ({ index, given: given[index], correct }));
    const evaluation: ClosedEvaluation = { items, correct: items.filter((i) => i.correct).length, total: items.length };
    return { evaluation, model: null, promptVersion: null };
}
