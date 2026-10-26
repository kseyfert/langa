import { COMMON, openGenerateSuite } from '../open-generate';

// Evals генерации free (architecture.md, «Evals»): всё общее — в open-generate.ts.
// requires_target у free — с полями рассуждения: без них судья не связывал провал с focus (контрольные случаи).
const REASONED = ['focus_structure', 'needed_context', 'context_quote'];

export const { versions, cases, task, evaluators, problems, reportItem } = openGenerateSuite('free', [
    ...COMMON.map((c) => (c.key === 'requires_target' ? { ...c, fields: REASONED } : c)),
    { key: 'prompt_ok', score: 'judge_prompt', issue: 'вопрос не короткий, не ясный или подсказывает содержание' },
]);
