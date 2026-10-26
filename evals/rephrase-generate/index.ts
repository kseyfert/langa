import { COMMON, openGenerateSuite } from '../open-generate';

// Evals генерации rephrase (architecture.md, «Evals»): всё общее — в open-generate.ts.
export const { versions, cases, task, evaluators, problems, reportItem } = openGenerateSuite('rephrase', COMMON);
