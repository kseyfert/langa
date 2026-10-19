'use client';

import type { CSSProperties } from 'react';
import { jump } from '@/components/jump';

export type MapStatus = 'idle' | 'learning' | 'mastered';
export type MapSection = { key: number; name: string; units: { id: number; number: number | null; title: string; status: MapStatus }[] };

const WORD: Record<MapStatus, string> = { idle: 'не начат', learning: 'в работе', mastered: 'освоен' };

/**
 * Карта книги: квадрат на юнит, разделы — разрывами. Клик ведёт к строке юнита.
 * С клавиатуры квадраты не достаются: те же строки ниже, и 145 остановок по Tab — лишние.
 */
export function UnitMap({ sections }: { sections: MapSection[] }) {
    const all = sections.flatMap((s) => s.units);
    const count = (st: MapStatus) => all.filter((u) => u.status === st).length;
    return (
        <div className="map" role="img" aria-label={`Освоено ${count('mastered')} из ${all.length}, в работе ${count('learning')}`}>
            {sections.map((s, i) => (
                <div key={s.key} className={`map__section${i >= sections.length / 2 ? ' map__section--end' : ''}`}
                    style={{ '--n': s.units.length } as CSSProperties}>
                    {s.units.map((u) => {
                        const href = `#unit-${u.id}`;
                        return (
                            <a key={u.id} href={href} tabIndex={-1} onClick={(e) => jump(e, href)}
                                className={`map__unit map__unit--${u.status}`}
                                data-tip={`${u.number ?? '—'}. ${u.title}\n${s.name} · ${WORD[u.status]}`} />
                        );
                    })}
                </div>
            ))}
        </div>
    );
}
