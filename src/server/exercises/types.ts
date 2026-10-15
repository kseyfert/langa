// Типы модуля «Задания» — specs/exercise-spec.md, разделы 2–4.
// Без server-only: схема БД импортирует их и в скриптах вне Next.

export const EXERCISE_TYPES = ['gap', 'choice', 'rephrase', 'translate', 'free'] as const;
export type ExerciseType = (typeof EXERCISE_TYPES)[number];

export const CLOSED_TYPES = ['gap', 'choice'] as const satisfies readonly ExerciseType[];
export const isClosed = (t: ExerciseType) => (CLOSED_TYPES as readonly string[]).includes(t);

export const EXERCISE_STATUSES = ['accepted', 'failed'] as const;
export type ExerciseStatus = (typeof EXERCISE_STATUSES)[number];

export const VERDICTS = ['correct_target', 'correct_non_target', 'incorrect'] as const;
export type Verdict = (typeof VERDICTS)[number];

// --- Содержимое задания (раздел 3) ---

export type GapContent = {
    instructions_ru: string;
    items: { text: string; answers: string[]; explain_ru: string }[];
    /** Пункты «Употребления» из guide, на которые составлено задание; в старых записях нет. */
    focus?: string[];
};

export type ChoiceContent = {
    instructions_ru: string;
    items: { text: string; options: string[]; correct: number; explain_ru: string }[];
    /** Как у GapContent. */
    focus?: string[];
};

export type TranslateContent = {
    instructions_ru: string;
    source_ru: string;
    target_note_ru: string;
    reference_en: string[];
};

export type RephraseContent = {
    instructions_ru: string;
    source_en: string;
    /** Пункт «Употребления» из guide, на который составлено задание; в старых записях нет. */
    focus?: string[];
    /** Только в старых заданиях (до rephrase-gen-v3): начало ответа выдавало конструкцию, больше не генерируется и не показывается. */
    start_with?: string;
    reference_en: string[];
};

export type FreeContent = {
    instructions_ru: string;
    prompt_ru: string;
    prompt_en: string;
    reference_en: string[];
};

export type ContentByType = {
    gap: GapContent;
    choice: ChoiceContent;
    translate: TranslateContent;
    rephrase: RephraseContent;
    free: FreeContent;
};
export type ExerciseContent = ContentByType[ExerciseType];

// --- Содержимое для клиента до проверки: без ключей и объяснений ---
// explain_ru тоже снят: объяснение пункта раскрывает ответ.

export type PublicContentByType = {
    gap: { instructions_ru: string; items: { text: string }[] };
    choice: { instructions_ru: string; items: { text: string; options: string[] }[] };
    translate: Omit<TranslateContent, 'target_note_ru' | 'reference_en'>;
    rephrase: Omit<RephraseContent, 'reference_en' | 'focus' | 'start_with'>;
    free: Omit<FreeContent, 'reference_en'>;
};

// --- Ответ и оценка попытки (раздел 4) ---

export type OpenAnswer = { text: string };
export type GapAnswer = string[];
export type ChoiceAnswer = (number | null)[];   // null — пункт без ответа
export type AnswerByType = {
    gap: GapAnswer;
    choice: ChoiceAnswer;
    translate: OpenAnswer;
    rephrase: OpenAnswer;
    free: OpenAnswer;
};
export type Answer = AnswerByType[ExerciseType];

export type OpenEvaluation = {
    verdict: Verdict;
    summary_ru: string;
    target: {
        status: 'correct' | 'error' | 'partial' | 'not_used';
        score: number | null;
        fragment: string;
        fix: string;
        comment_ru: string;
    };
    others: {
        unit_id: number;
        status: 'correct' | 'error' | 'partial';
        score: number;
        notable: boolean;
        fragment: string;
        fix: string;
        comment_ru: string;
    }[];
    issues: { fragment: string; fix: string; comment_ru: string }[];
    corrected_answer: string;
    natural_version: string;
};

export type ClosedEvaluation = {
    items: { index: number; given: string | number | null; correct: boolean }[];
    correct: number;
    total: number;
};

export type Evaluation = OpenEvaluation | ClosedEvaluation;
export const isOpenEvaluation = (e: Evaluation): e is OpenEvaluation => 'verdict' in e;

// --- Записи из БД ---

type ExerciseBase = {
    id: number;
    unitId: number;
    status: ExerciseStatus | null;
    targetScore: number | null;
    topic: string;
    model: string;
    promptVersion: string;
    createdAt: string;
    finishedAt: string | null;
};

/** Задание; type и content связаны: по type TypeScript знает форму content. */
export type Exercise = { [T in ExerciseType]: ExerciseBase & { type: T; content: ContentByType[T] } }[ExerciseType];

export type Attempt = {
    id: number;
    exerciseId: number;
    seq: number;
    answer: Answer;
    evaluation: Evaluation;
    verdict: Verdict | null;
    model: string | null;
    promptVersion: string | null;
    createdAt: string;
};

export type ExerciseWithAttempts = Exercise & { attempts: Attempt[] };
