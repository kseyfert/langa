import 'server-only';
import { getUnit } from '../catalog';
import type { ExerciseType } from '../exercises/types';
import { askJson, MODEL_GENERATE } from './claude';
import { prompts, seed, unitValues } from './prompt';
import { typeOf } from './registry';
import { randomTopic } from './topics';
import type { Generated } from './types';
import { plan, recent } from './variety';

/** Тема и недавние задания извне — для evals. Приложение их не передаёт: тема случайная, недавние — из лога. */
export type GenerateOptions = { topic?: string; recent?: string[] };

/**
 * Составить задание по юниту — один конвейер на все типы: тема, недавние задания, план фокуса,
 * промпты типа, вызов модели со схемой типа, его normalize. Чем типы различаются — в их определениях.
 */
export async function generate(type: ExerciseType, unitId: number, opts: GenerateOptions = {}): Promise<Generated<ExerciseType>> {
    const def = typeOf(type);
    // Пометка повтора нужна, только когда пунктов в задании больше одного: иначе повторов не бывает.
    const p = prompts<'generate' | 'focus-repeat'>(type, def.items > 1 ? ['generate', 'focus-repeat'] : ['generate']);
    const topic = opts.topic ?? randomTopic();
    const [unit, used] = await Promise.all([getUnit(unitId), opts.recent ?? recent(unitId)]);
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
