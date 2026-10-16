import 'server-only';
import { unitForPrompt } from '../catalog';
import type { FreeContent } from '../exercises/types';
import { askJson, MODEL_GENERATE } from './claude';
import { gradeOpen, parseOpenAnswer } from './grade';
import { randomTopic } from './topics';
import { TaskError, type Task } from './types';
import { variety } from './variety';

const PROMPT_VERSION = 'free-gen-v1';

// Текст — genPrompt прототипа, шапка та же, что у остальных типов (specs/exercise-spec.md §7).
function prompt(unit: string, topic: string, varietyRules: string): string {
    return `You write grammar practice for a Russian-speaking adult learner of English (around B2).

Target unit:
${unit}

Practise only the grammar described for this unit. Do not touch topics listed under "Не входит в юнит": they belong to other units.
Context theme: ${topic}. Use natural, varied, everyday English; avoid textbook clichés. Random seed: ${Math.random().toString(36).slice(2, 8)}.
All *_ru fields are in Russian.

${varietyRules}

Make one free-answer task.
- "prompt_en": a short situation or question in English (1–2 sentences), addressed to the learner personally as "you", that naturally invites the target structure in an answer of 2–4 English sentences.
- Choose a situation where a native speaker answering naturally would use the target structure; avoid questions that are just as naturally answered without it.
- Do not name or describe the grammar. Do not list what the answer should contain or give example content: the situation alone must lead to the structure.
- Avoid the target structure in prompt_en wherever another natural wording exists, so the question does not hand over the answer. Keep the English simple and clear.
- Do not repeat the instructions (answer length, language) inside the prompt.
- "instructions_ru": generic, must not name or describe the grammar, e.g. "Ответь по-английски в 2–4 предложениях."
Reply with only JSON: {"instructions_ru":"...","prompt_en":"...","reference_en":["one model answer"]}`;
}

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

/** Задание для промпта проверки — exerciseForPrompt прототипа. */
const forGrade = (c: FreeContent) => [
    'Task: answer in 2–4 English sentences.',
    `Question: ${c.prompt_en || c.prompt_ru}`,
    `Model answer: ${c.reference_en.join(' | ')}`,
].join('\n');

export const free: Task<'free'> = {
    type: 'free',

    async generate(unitId) {
        const topic = randomTopic();
        const [unit, v] = await Promise.all([unitForPrompt(unitId), variety(unitId, 1)]);
        const content = { ...normalize(await askJson(prompt(unit, topic, v.prompt), MODEL_GENERATE)), focus: v.focus };
        return { content, topic, model: MODEL_GENERATE, promptVersion: PROMPT_VERSION };
    },

    parseAnswer: parseOpenAnswer,

    check: (unitId, content, answer) => gradeOpen(unitId, forGrade(content), answer.text),
};
