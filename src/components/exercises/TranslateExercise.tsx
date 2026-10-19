'use client';

import type { PublicContentByType } from '@/server/exercises/types';
import { OpenExercise } from './OpenExercise';

/** Перевод: русский текст перевести на английский, естественный перевод требует целевой конструкции. */
export function TranslateExercise({ exerciseId, content, targetName, onDone }: { exerciseId: number; content: PublicContentByType['translate']; targetName: string; onDone?: (ok: boolean) => void }) {
    return (
        <OpenExercise
            exerciseId={exerciseId}
            instructions={content.instructions_ru}
            task={content.source_ru}
            targetName={targetName}
            onDone={onDone}
        />
    );
}
