import 'server-only';
import { getUnit } from '../../catalog';
import type { RephraseContent } from '../../exercises/types';
import { askJson, MODEL_GENERATE } from '../claude';
import { gradeOpen, parseOpenAnswer } from '../grade';
import { prompts, seed, unitValues } from '../prompt';
import { randomTopic } from '../topics';
import { TaskError, type Task } from '../types';
import { plan, recent } from '../variety';

const isStr = (v: unknown): v is string => typeof v === 'string';

/** Как normalizeEx прототипа: без исходного предложения задания нет. */
function normalize(d: unknown): RephraseContent {
    const o = (d ?? {}) as Record<string, unknown>;
    if (!isStr(o.source_en) || !o.source_en.trim()) throw new TaskError('Claude ответил в неожиданном формате. Попробуй ещё раз.');
    return {
        instructions_ru: isStr(o.instructions_ru) ? o.instructions_ru : '',
        source_en: o.source_en,
        reference_en: Array.isArray(o.reference_en) ? o.reference_en.filter(isStr) : [],
    };
}

/** Как GapOptions: тема и недавние задания извне — для evals, приложение их не передаёт. */
export type RephraseOptions = { topic?: string; recent?: string[] };

export const rephrase = {
    type: 'rephrase',

    async generate(unitId: number, opts: RephraseOptions = {}) {
        const p = prompts('rephrase', ['generate']);
        const topic = opts.topic ?? randomTopic();
        const [unit, used] = await Promise.all([getUnit(unitId), opts.recent ?? recent(unitId)]);
        const focus = plan(unit.guide, 1);
        const prompt = p.fill('generate', {
            ...unitValues(unit), topic, seed: seed(),
            focus: focus[0] ?? '',
            recent: used.map((s) => `- ${s}`).join('\n'),
        });
        const raw = await askJson(prompt, MODEL_GENERATE, undefined, {
            call: 'generate', type: 'rephrase', promptVersion: p.version, unitId, workspaceId: unit.workspaceId,
        });
        const content = { ...normalize(raw), focus };
        return { content, topic, model: MODEL_GENERATE, promptVersion: p.version };
    },

    parseAnswer: parseOpenAnswer,

    check: (unitId, content, answer) => gradeOpen('rephrase', unitId, {
        source: content.source_en,
        instructions: content.instructions_ru,
        reference: content.reference_en.join(' | '),
    }, answer.text),
} satisfies Task<'rephrase'>;
