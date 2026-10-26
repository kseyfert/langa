import { COMMON, openGenerateSuite } from '../open-generate';

// Evals генерации free (architecture.md, «Evals»): всё общее — в open-generate.ts.
export const { versions, cases, task, evaluators, problems, reportItem } = openGenerateSuite('free', [
    ...COMMON,
    { key: 'prompt_ok', score: 'judge_prompt', issue: 'вопрос не короткий, не ясный или подсказывает содержание' },
]);
