import 'server-only';
import { getUnit } from '../../catalog';
import type { ChoiceContent, ClosedEvaluation } from '../../exercises/types';
import { askJson, MODEL_GENERATE } from '../claude';
import { prompts, seed, unitValues } from '../prompt';
import { randomTopic } from '../topics';
import { TaskError, type Task } from '../types';
import { plan, recent } from '../variety';

const isStr = (v: unknown): v is string => typeof v === 'string';

type Item = ChoiceContent['items'][number];

/** Пункт задания или null, если он не той формы. */
function item(i: unknown): Item | null {
    const o = (i ?? {}) as { text?: unknown; options?: unknown; correct?: unknown; explain_ru?: unknown };
    const ok = isStr(o.text) && o.text.split('___').length === 2 && Array.isArray(o.options)
        && o.options.length > 1 && o.options.every(isStr) && Number.isInteger(o.correct)
        && (o.correct as number) >= 0 && (o.correct as number) < o.options.length;
    return ok ? { text: o.text as string, options: o.options as string[], correct: o.correct as number, explain_ru: isStr(o.explain_ru) ? o.explain_ru : '' } : null;
}

/** Как у gap: годные пункты, план фокуса прорежен вместе с ними. */
function normalize(d: unknown, plan: string[]): ChoiceContent {
    const o = (d ?? {}) as { instructions_ru?: unknown; items?: unknown };
    const all = (Array.isArray(o.items) ? o.items : []).map(item);
    const kept = all.flatMap((it, k) => (it ? [k] : []));
    if (!kept.length) throw new TaskError('Claude ответил в неожиданном формате. Попробуй ещё раз.');
    return {
        instructions_ru: isStr(o.instructions_ru) ? o.instructions_ru : '',
        items: kept.map((k) => all[k]!),
        focus: kept.map((k) => plan[k] ?? ''),
    };
}

export const choice: Task<'choice'> = {
    type: 'choice',

    async generate(unitId) {
        const p = prompts('choice', ['generate', 'focus-repeat']);
        const topic = randomTopic();
        const [unit, used] = await Promise.all([getUnit(unitId), recent(unitId)]);
        const focus = plan(unit.guide, 6, (point) => p.fill('focus-repeat', { point }));
        const prompt = p.fill('generate', {
            ...unitValues(unit), topic, seed: seed(),
            focus: focus.map((f, i) => `${i + 1}. ${f}`).join('\n'),
            recent: used.map((s) => `- ${s}`).join('\n'),
        });
        const content = normalize(await askJson(prompt, MODEL_GENERATE), focus);
        return { content, topic, model: MODEL_GENERATE, promptVersion: p.version };
    },

    parseAnswer(raw, content) {
        const ok = Array.isArray(raw) && raw.length === content.items.length
            && raw.every((v, i) => v === null || (Number.isInteger(v) && v >= 0 && v < content.items[i].options.length));
        if (!ok) throw new TaskError(`Нужно ответов: ${content.items.length}, по одному на пункт`);
        return raw as (number | null)[];
    },

    async check(_unitId, content, answer) {
        const items = content.items.map((it, index) => ({ index, given: answer[index], correct: answer[index] === it.correct }));
        const evaluation: ClosedEvaluation = { items, correct: items.filter((i) => i.correct).length, total: items.length };
        return { evaluation, model: null, promptVersion: null };
    },
};
