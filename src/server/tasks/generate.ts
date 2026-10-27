import 'server-only';
import { getUnit } from '../catalog';
import { workspaceContent } from '../content';
import type { ExerciseType } from '../exercises/types';
import { askJson, MODEL_GENERATE } from './claude';
import { prompts, seed, unitValues } from './prompt';
import { typeOf } from './registry';
import { TaskError, type Generated } from './types';
import { plan, recent } from './variety';

/** Тема и недавние задания извне — для evals. Приложение их не передаёт: тема случайная, недавние — из лога. */
export type GenerateOptions = { topic?: string; recent?: string[] };

/**
 * Составить задание по юниту — один конвейер на все типы: тема, недавние задания, план фокуса,
 * промпты типа из содержимого области юнита, вызов модели со схемой типа, его normalize.
 * Чем типы различаются — в их определениях, чем области — в content/<key>/.
 */
export async function generate(type: ExerciseType, unitId: number, opts: GenerateOptions = {}): Promise<Generated<ExerciseType>> {
    const def = typeOf(type);
    const [unit, used] = await Promise.all([getUnit(unitId), opts.recent ?? recent(unitId)]);
    const ws = await workspaceContent(unit.workspaceId);
    if (!ws.types.includes(type)) throw new TaskError(`Тип ${type} не подключён к области`);
    // Пометка повтора нужна, только когда пунктов в задании больше одного: иначе повторов не бывает.
    const p = prompts<'generate' | 'focus-repeat'>(ws.key, type, def.items > 1 ? ['generate', 'focus-repeat'] : ['generate']);
    // Тем у области нет — темы нет: в exercises.topic пустая строка, промпты области {{topic}} не используют.
    const topic = opts.topic ?? (ws.topics.length ? ws.topics[Math.floor(Math.random() * ws.topics.length)] : '');
    const focus = plan(unit.guide, def.items, def.items > 1 ? (point) => p.fill('focus-repeat', { point }) : undefined);
    const prompt = p.fill('generate', {
        ...unitValues(unit), topic, seed: seed(),
        // Несколько пунктов — нумерованный план, по строке на предложение; один — сам пункт.
        focus: def.items > 1 ? focus.map((f, i) => `${i + 1}. ${f}`).join('\n') : focus[0] ?? '',
        recent: used.map((s) => `- ${s}`).join('\n'),
        ...def.generateValues,
    });
    const raw = await askJson(prompt, MODEL_GENERATE, undefined, {
        call: 'generate', type, promptVersion: p.version, unitId, workspaceId: unit.workspaceId,
    }, def.outputSchema);
    return { content: def.normalize(raw, focus), topic, model: MODEL_GENERATE, promptVersion: p.version };
}
