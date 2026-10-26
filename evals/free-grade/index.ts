import { gradeSuite } from '../grade';

// Evals проверки открытых ответов free (architecture.md, «Evals»): всё общее — в grade.ts.
export const { versions, cases, lint, task, evaluators, problems, reportItem } = gradeSuite('free');
