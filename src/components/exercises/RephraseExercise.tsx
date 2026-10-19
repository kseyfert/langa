'use client';

import type { PublicContentByType } from '@/server/exercises/types';
import { OpenExercise } from './OpenExercise';

/** Перефразирование: исходное предложение переписать с целевой конструкцией. */
export function RephraseExercise({ exerciseId, content, targetName, onDone }: { exerciseId: number; content: PublicContentByType['rephrase']; targetName: string; onDone?: (ok: boolean) => void }) {
    return (
        <OpenExercise
            exerciseId={exerciseId}
            instructions={content.instructions_ru}
            task={content.source_en}
            targetName={targetName}
            onDone={onDone}
        />
    );
}
