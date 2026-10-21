import 'server-only';
import { getUnit } from '../../catalog';
import type { TranslateContent } from '../../exercises/types';
import { askJson, MODEL_GENERATE } from '../claude';
import { gradeOpen, parseOpenAnswer } from '../grade';
import { prompts, seed, unitValues } from '../prompt';
import { randomTopic } from '../topics';
import { TaskError, type Task } from '../types';
import { plan, recent } from '../variety';

const isStr = (v: unknown): v is string => typeof v === 'string';

/** Как normalizeEx прототипа: без исходного текста задания нет. */
function normalize(d: unknown): TranslateContent {
    const o = (d ?? {}) as Record<string, unknown>;
    if (!isStr(o.source_ru) || !o.source_ru.trim()) throw new TaskError('Claude ответил в неожиданном формате. Попробуй ещё раз.');
    return {
        instructions_ru: isStr(o.instructions_ru) ? o.instructions_ru : '',
        source_ru: o.source_ru,
        target_note_ru: isStr(o.target_note_ru) ? o.target_note_ru : '',
        reference_en: Array.isArray(o.reference_en) ? o.reference_en.filter(isStr) : [],
    };
}

export const translate: Task<'translate'> = {
    type: 'translate',

    async generate(unitId) {
        const p = prompts('translate', ['generate']);
        const topic = randomTopic();
        const [unit, used] = await Promise.all([getUnit(unitId), recent(unitId)]);
        const focus = plan(unit.guide, 1);
        const prompt = p.fill('generate', {
            ...unitValues(unit), topic, seed: seed(),
            focus: focus[0] ?? '',
            recent: used.map((s) => `- ${s}`).join('\n'),
        });
        const content = { ...normalize(await askJson(prompt, MODEL_GENERATE)), focus };
        return { content, topic, model: MODEL_GENERATE, promptVersion: p.version };
    },

    parseAnswer: parseOpenAnswer,

    check: (unitId, content, answer) => gradeOpen('translate', unitId, {
        source: content.source_ru,
        reference: content.reference_en.join(' | '),
    }, answer.text),
};
