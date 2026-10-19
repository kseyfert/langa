'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, useTransition, type FormEvent, type ReactNode } from 'react';
import { checkExercise, revealExercise } from '@/app/actions';
import type { Exercise, OpenEvaluation } from '@/server/exercises/types';
import { ExerciseActions } from './ExerciseActions';
import { OpenAttempt } from './OpenAttempt';
import './Exercise.css';
import './OpenExercise.css';

type Done = { answer: string; evaluation: OpenEvaluation };

type Props = {
    exerciseId: number;
    instructions: string;
    /** Само задание: исходное предложение, текст на перевод, вопрос. */
    task: ReactNode;
    /** «номер. название» целевого юнита — подпись к его правкам. */
    targetName: string;
    /** Рамки объёма ответа в символах: счётчик у кнопки, вне рамок проверить нельзя. */
    length?: { min: number; max: number };
    /** Задание завершено; ok — принято. */
    onDone?: (ok: boolean) => void;
};

/**
 * Открытое задание (rephrase, translate, free): ответ проверяет Claude.
 * После «верно, но без нужной конструкции» разбор скрыт, пока нет следующей
 * попытки или пока не нажат «Показать разбор» (exercise-spec §8).
 */
export function OpenExercise({ exerciseId, instructions, task, targetName, length, onDone }: Props) {
    const [draft, setDraft] = useState('');
    const [attempts, setAttempts] = useState<Done[]>([]);
    const [units, setUnits] = useState<Record<number, string>>({});
    const [retryRu, setRetryRu] = useState<string | null>(null);
    const [finished, setFinished] = useState(false);
    const [solution, setSolution] = useState<Exercise | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, startBusy] = useTransition();
    const router = useRouter();
    const formId = useId();

    // Ждёт вторую попытку: разбор последней скрыт, форма снова открыта.
    const pending = retryRu != null && !solution;
    const showForm = !finished && (attempts.length === 0 || pending);

    // Считается то же, что уйдёт на проверку, — без пробелов по краям.
    const chars = draft.trim().length;
    const fits = !length || (chars >= length.min && chars <= length.max);

    const submit = (e: FormEvent) => {
        e.preventDefault();
        const text = draft.trim();
        if (!text || busy || !fits) return;
        startBusy(async () => {
            setError(null);
            const res = await checkExercise(exerciseId, { text });
            if (!res.ok) return setError(res.error);
            const ev = res.attempt.evaluation;
            if (!('verdict' in ev)) return setError('Сервер вернул проверку не того вида');
            setAttempts((a) => [...a, { answer: text, evaluation: ev }]);
            setUnits((u) => ({ ...u, ...res.units }));
            setRetryRu(res.retryRu);
            setFinished(res.status != null);
            setSolution(res.solution);
            setDraft('');
            if (res.status) onDone?.(res.status === 'accepted');
            // Попытка изменила рейтинг юнита — перечитать страницу с сервера; состояние формы останется.
            router.refresh();
        });
    };

    const reveal = () =>
        startBusy(async () => {
            setError(null);
            const res = await revealExercise(exerciseId);
            if (!res.ok) return setError(res.error);
            setSolution(res.solution);
        });

    // Эталон — один: почти одинаковые варианты (а в старых заданиях их бывает по три) только шумят.
    const references = solution && 'reference_en' in solution.content ? solution.content.reference_en.slice(0, 1) : [];
    // «Что заметить» есть только у перевода; как и эталон, приходит с разбором.
    const note = solution && 'target_note_ru' in solution.content ? solution.content.target_note_ru : '';
    return (
        <div className="exercise">
            {instructions && <p className="exercise__instructions">{instructions}</p>}
            <div className="open__task">{task}</div>

            {attempts.map((a, i) => (
                <OpenAttempt
                    key={i}
                    label={attempts.length > 1 ? `Попытка ${i + 1}` : null}
                    answer={a.answer}
                    evaluation={a.evaluation}
                    units={units}
                    targetName={targetName}
                    // Эталон — один на задание: показывается в последнем разборе.
                    references={i === attempts.length - 1 ? references : []}
                    note={i === attempts.length - 1 ? note : ''}
                    concealed={pending && i === attempts.length - 1}
                />
            ))}

            {showForm && (
                <form id={formId} className={`open__form${pending ? ' open__form--retry' : ''}`} onSubmit={submit}>
                    {pending && <p className="open__retry">{retryRu}</p>}
                    <textarea
                        className="input open__answer"
                        aria-label="Твой ответ"
                        placeholder={pending ? 'Ещё одна попытка' : 'Твой ответ на английском'}
                        rows={3}
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        // Enter — перенос строки, Cmd/Ctrl+Enter — проверить.
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                                e.preventDefault();
                                e.currentTarget.form?.requestSubmit();
                            }
                        }}
                        autoCapitalize="off" spellCheck={false}
                    />
                    {error && <p className="error">{error}</p>}
                    <ExerciseActions>
                        {pending && (
                            <button type="button" className="btn btn--quiet" disabled={busy} onClick={reveal}>
                                Показать разбор
                            </button>
                        )}
                        {length && (
                            <span className={`open__count mono${chars > length.max ? ' open__count--over' : ''}`}
                                title={`Нужно от ${length.min} до ${length.max} символов`}>
                                {chars} / {length.min} — {length.max}
                            </span>
                        )}
                        <button type="submit" form={formId} className="btn btn--primary exercise__check" disabled={busy || !draft.trim() || !fits}>
                            {busy ? 'Проверяю…' : 'Проверить'}
                        </button>
                    </ExerciseActions>
                </form>
            )}
            {!showForm && error && <p className="error">{error}</p>}
        </div>
    );
}
