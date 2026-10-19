'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Куда вынести кнопки задания. null — на место, под задание (строка юнита);
 * элемент — туда (нижняя полоса плеера сессии, в один ряд с «Пропустить»).
 */
export const ActionsSlot = createContext<HTMLElement | null>(null);

/**
 * Блок действий задания. Вынесенный порталом, он оказывается вне <form> —
 * поэтому кнопки отправки привязаны к форме атрибутом form={id}, а не вложенностью.
 */
export function ExerciseActions({ children }: { children: ReactNode }) {
    const slot = useContext(ActionsSlot);
    if (!slot) return <div className="exercise__actions row">{children}</div>;
    return createPortal(<div className="exercise__actions exercise__actions--slot row">{children}</div>, slot);
}

/** Блок вынесен — итог «Верно N из M» показывает тот, кто вынес. */
export const useActionsSlotted = () => useContext(ActionsSlot) != null;
