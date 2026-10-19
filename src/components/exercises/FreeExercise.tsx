'use client';

import type { PublicContentByType } from '@/server/exercises/types';
import { FREE_LENGTH } from '@/server/tasks/types';
import { OpenExercise } from './OpenExercise';

/** Свободный ответ: на ситуацию или вопрос ответить в 2–4 предложениях; естественный ответ — с целевой конструкцией. */
export function FreeExercise({ exerciseId, content, targetName, onDone }: { exerciseId: number; content: PublicContentByType['free']; targetName: string; onDone?: (ok: boolean) => void }) {
    return (
        <OpenExercise
            exerciseId={exerciseId}
            instructions={content.instructions_ru}
            // Задание на английском; prompt_ru — только у старых записей без английского.
            task={content.prompt_en || content.prompt_ru}
            targetName={targetName}
            onDone={onDone}
            length={FREE_LENGTH}
        />
    );
}
