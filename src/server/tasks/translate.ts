import 'server-only';
import { unitForPrompt } from '../catalog';
import type { TranslateContent } from '../exercises/types';
import { askJson, MODEL_GENERATE } from './claude';
import { gradeOpen } from './grade';
import { parseOpenAnswer } from './mock';
import { randomTopic } from './topics';
import { TaskError, type Task } from './types';
import { variety } from './variety';

const PROMPT_VERSION = 'translate-gen-v1';

// Текст — genPrompt прототипа, шапка та же, что у gap, choice и rephrase (specs/exercise-spec.md §7).
function prompt(unit: string, topic: string, varietyRules: string): string {
    return `You write grammar practice for a Russian-speaking adult learner of English (around B2).

Target unit:
${unit}

Practise only the grammar described for this unit. Do not touch topics listed under "Не входит в юнит": they belong to other units.
Context theme: ${topic}. Use natural, varied, everyday English; avoid textbook clichés. Random seed: ${Math.random().toString(36).slice(2, 8)}.
All *_ru fields are in Russian.

${varietyRules}

Make one translation task from Russian into English.
- "source_ru": 1–3 connected, natural Russian sentences, the way a Russian speaker would actually say it (not a word-for-word calque of English).
- The most natural correct English translation must REQUIRE the target structure. Build the context (time markers, situation, consequences) so that a translation without it would be wrong or clearly unnatural.
- Do not mention grammar in the source.
- "instructions_ru": generic, must not name or describe the grammar, e.g. "Переведи на английский."
- "target_note_ru": one or two short sentences on what the learner should notice; it is shown only after checking. Address the learner as «ты».
Reply with only JSON: {"instructions_ru":"...","source_ru":"...","target_note_ru":"...","reference_en":["one model translation"]}`;
}

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

/** Задание для промпта проверки — exerciseForPrompt прототипа. */
const forGrade = (c: TranslateContent) => [
    'Task: translate into English.',
    `Russian source: ${c.source_ru}`,
    `Reference translation: ${c.reference_en.join(' | ')}`,
].join('\n');

export const translate: Task<'translate'> = {
    type: 'translate',

    async generate(unitId) {
        const topic = randomTopic();
        const [unit, v] = await Promise.all([unitForPrompt(unitId), variety(unitId, 1)]);
        const content = { ...normalize(await askJson(prompt(unit, topic, v.prompt), MODEL_GENERATE)), focus: v.focus };
        return { content, topic, model: MODEL_GENERATE, promptVersion: PROMPT_VERSION };
    },

    parseAnswer: parseOpenAnswer,

    check: (unitId, content, answer) => gradeOpen(unitId, forGrade(content), answer.text),
};
