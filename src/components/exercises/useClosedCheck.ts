'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { checkExercise } from '@/app/actions';
import type { ClosedEvaluation, ContentByType } from '@/server/exercises/types';

type ClosedType = 'gap' | 'choice';
type Checked<T extends ClosedType> = { evaluation: ClosedEvaluation; solution: ContentByType[T] };

/** Проверка закрытого задания: одна попытка, после неё — оценка и задание с ключами. */
export function useClosedCheck<T extends ClosedType>(exerciseId: number, type: T) {
    const [checked, setChecked] = useState<Checked<T> | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, startBusy] = useTransition();
    const router = useRouter();

    const submit = (answer: unknown) => {
        if (checked || busy) return;
        startBusy(async () => {
            setError(null);
            const res = await checkExercise(exerciseId, answer);
            if (!res.ok) return setError(res.error);
            if (res.solution?.type !== type || 'verdict' in res.attempt.evaluation) {
                return setError('Сервер вернул проверку не того вида');
            }
            setChecked({ evaluation: res.attempt.evaluation, solution: res.solution.content as ContentByType[T] });
            // Попытка изменила рейтинг юнита — перечитать страницу с сервера; состояние формы останется.
            router.refresh();
        });
    };

    return { checked, error, busy, submit };
}
