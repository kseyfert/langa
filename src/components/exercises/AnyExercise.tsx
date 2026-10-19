'use client';

import type { ExerciseView } from '@/server/tasks';
import { ChoiceExercise } from './ChoiceExercise';
import { FreeExercise } from './FreeExercise';
import { GapExercise } from './GapExercise';
import { RephraseExercise } from './RephraseExercise';
import { TranslateExercise } from './TranslateExercise';

type Props = {
    exercise: ExerciseView;
    /** «номер. название» целевого юнита — подпись к правкам в разборе открытого ответа. */
    targetName: string;
    /** Задание завершено; ok — засчитано. */
    onDone?: (ok: boolean) => void;
};

/** Задание любого типа. Одно место выбора компонента — для строки юнита и для плеера сессии. */
export function AnyExercise({ exercise: ex, targetName, onDone }: Props) {
    switch (ex.type) {
        case 'gap': return <GapExercise key={ex.id} exerciseId={ex.id} content={ex.content} onDone={onDone} />;
        case 'choice': return <ChoiceExercise key={ex.id} exerciseId={ex.id} content={ex.content} onDone={onDone} />;
        case 'rephrase': return <RephraseExercise key={ex.id} exerciseId={ex.id} content={ex.content} targetName={targetName} onDone={onDone} />;
        case 'translate': return <TranslateExercise key={ex.id} exerciseId={ex.id} content={ex.content} targetName={targetName} onDone={onDone} />;
        case 'free': return <FreeExercise key={ex.id} exerciseId={ex.id} content={ex.content} targetName={targetName} onDone={onDone} />;
    }
}
