'use client';

import type { PublicContentByType } from '@/server/exercises/types';
import { OpenExercise } from './OpenExercise';

/** Перефразирование: исходное предложение переписать с целевой конструкцией. */
export function RephraseExercise({ exerciseId, content, targetName }: { exerciseId: number; content: PublicContentByType['rephrase']; targetName: string }) {
    return (
        <OpenExercise
            exerciseId={exerciseId}
            instructions={content.instructions_ru}
            task={content.source_en}
            targetName={targetName}
        />
    );
}
