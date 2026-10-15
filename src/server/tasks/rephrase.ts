import 'server-only';
import { unitForPrompt } from '../catalog';
import type { RephraseContent } from '../exercises/types';
import { askJson, MODEL_GENERATE } from './claude';
import { gradeOpen } from './grade';
import { parseOpenAnswer } from './mock';
import { randomTopic } from './topics';
import { TaskError, type Task } from './types';
import { variety } from './variety';

const PROMPT_VERSION = 'rephrase-gen-v4';

// Текст — genPrompt прототипа, шапка та же, что у gap и choice (specs/exercise-spec.md §7).
function prompt(unit: string, topic: string, varietyRules: string): string {
    return `You write grammar practice for a Russian-speaking adult learner of English (around B2).

Target unit:
${unit}

Practise only the grammar described for this unit. Do not touch topics listed under "Не входит в юнит": they belong to other units.
Context theme: ${topic}. Use natural, varied, everyday English; avoid textbook clichés. Random seed: ${Math.random().toString(36).slice(2, 8)}.
All *_ru fields are in Russian.

${varietyRules}

Make one rephrasing task.
- "source_en": an English sentence that does NOT contain the target structure.
- The learner rewrites it in their own words with the same meaning; the natural rewrite uses the target structure.
- Choose a source sentence where the target structure is the most natural way for a native speaker to express the same meaning; avoid situations with many equally natural paraphrases that bypass it.
- Do not generate any opening words, key words or hints for the answer.
- "instructions_ru": generic, must not name or describe the grammar, e.g. "Перепиши предложение другими словами, сохранив смысл."
Reply with only JSON: {"instructions_ru":"...","source_en":"...","reference_en":["one model answer"]}`;
}

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

/** Задание для промпта проверки — exerciseForPrompt прототипа. */
const forGrade = (c: RephraseContent) => [
    'Task: rewrite the sentence in other words, keeping the meaning, using the target structure.',
    `Source: ${c.source_en}`,
    `Instructions given: ${c.instructions_ru}`,
    `Reference: ${c.reference_en.join(' | ')}`,
].filter(Boolean).join('\n');

export const rephrase: Task<'rephrase'> = {
    type: 'rephrase',

    async generate(unitId) {
        const topic = randomTopic();
        const [unit, v] = await Promise.all([unitForPrompt(unitId), variety(unitId, 1)]);
        const content = { ...normalize(await askJson(prompt(unit, topic, v.prompt), MODEL_GENERATE)), focus: v.focus };
        return { content, topic, model: MODEL_GENERATE, promptVersion: PROMPT_VERSION };
    },

    parseAnswer: parseOpenAnswer,

    check: (unitId, content, answer) => gradeOpen(unitId, forGrade(content), answer.text),
};
