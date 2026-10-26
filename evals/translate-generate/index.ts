import { COMMON, openGenerateSuite } from '../open-generate';

// Evals генерации translate (architecture.md, «Evals»): всё общее — в open-generate.ts.
export const { versions, cases, task, evaluators, problems, reportItem } = openGenerateSuite('translate', [
    ...COMMON,
    { key: 'source_natural', score: 'judge_source_natural', issue: 'русский текст — калька' },
    { key: 'note_ok', score: 'judge_note', issue: 'target_note_ru неверен' },
]);
