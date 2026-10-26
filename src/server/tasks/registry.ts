import 'server-only';
import type { ExerciseType } from '../exercises/types';
import { choice } from './choice';
import { free } from './free';
import { gap } from './gap';
import { rephrase } from './rephrase';
import { translate } from './translate';
import type { TaskType } from './types';

// Реестр типов заданий — единственное место, где перечислены их определения:
// отсюда их берут конвейер генерации, проверка, publicContent (exercises) и variety.

const TYPES: { [T in ExerciseType]: TaskType<T> } = { gap, choice, translate, rephrase, free };

/** Определение по типу. Связь type ↔ content TypeScript через union не проводит — здесь она гарантирована реестром. */
export const typeOf = (type: ExerciseType) => TYPES[type] as TaskType<ExerciseType>;
