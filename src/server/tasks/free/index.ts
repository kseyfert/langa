import 'server-only';
import { getUnit } from '../../catalog';
import type { FreeContent } from '../../exercises/types';
import { askJson, MODEL_GENERATE } from '../claude';
import { gradeOpen, parseOpenAnswer } from '../grade';
import { prompts, seed, unitValues } from '../prompt';
import { randomTopic } from '../topics';
import { FREE_LENGTH, TaskError, type Task } from '../types';
import { plan, recent } from '../variety';

const isStr = (v: unknown): v is string => typeof v === 'string';

/** Как normalizeEx прототипа: без вопроса задания нет. */
function normalize(d: unknown): FreeContent {
    const o = (d ?? {}) as Record<string, unknown>;
    if (!isStr(o.prompt_en) || !o.prompt_en.trim()) throw new TaskError('Claude ответил в неожиданном формате. Попробуй ещё раз.');
    return {
        instructions_ru: isStr(o.instructions_ru) ? o.instructions_ru : '',
        prompt_en: o.prompt_en,
        reference_en: Array.isArray(o.reference_en) ? o.reference_en.filter(isStr) : [],
    };
}

export const free: Task<'free'> = {
    type: 'free',

    async generate(unitId) {
        const p = prompts('free', ['generate']);
        const topic = randomTopic();
        const [unit, used] = await Promise.all([getUnit(unitId), recent(unitId)]);
        const focus = plan(unit.guide, 1);
        const prompt = p.fill('generate', {
            ...unitValues(unit), topic, seed: seed(),
            focus: focus[0] ?? '',
            recent: used.map((s) => `- ${s}`).join('\n'),
            min: String(FREE_LENGTH.min), max: String(FREE_LENGTH.max),
        });
        const content = { ...normalize(await askJson(prompt, MODEL_GENERATE)), focus };
        return { content, topic, model: MODEL_GENERATE, promptVersion: p.version };
    },

    parseAnswer(raw) {
        const answer = parseOpenAnswer(raw);
        const n = answer.text.length;
        if (n < FREE_LENGTH.min || n > FREE_LENGTH.max) throw new TaskError(`Нужно от ${FREE_LENGTH.min} до ${FREE_LENGTH.max} символов, сейчас ${n}`);
        return answer;
    },

    check: (unitId, content, answer) => gradeOpen('free', unitId, {
        question: content.prompt_en || content.prompt_ru || '',
        reference: content.reference_en.join(' | '),
    }, answer.text),
};
