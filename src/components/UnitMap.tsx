'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { jump } from '@/components/jump';
import type { UnitStatus } from '@/components/unitStatus';
import './UnitMap.css';

type MapStatus = UnitStatus;
export type MapSection = { key: number; name: string; units: { id: number; number: number | null; title: string; status: MapStatus }[] };

const WORD: Record<MapStatus, string> = { idle: 'не начат', learning: 'в работе', mastered: 'освоен' };

/** Размеры — те же, что в UnitMap.css (--map-unit, 1px, --s-2): по ним карта раскладывает разделы по строкам. */
const UNIT = 3;
const UNIT_GAP = 1;
const SECTION_GAP = 8;
/**
 * Строка растягивается на всю ширину, только если и так занимает не меньше этой доли: иначе разрывы
 * между разделами стали бы огромными (лексика — 466 из 828px). Последняя из нескольких строк — всегда влево.
 */
const SPREAD_FILL = 0.75;
/** Ширина до замера — колонка .app на десктопе (860 минус поля): сервер рисует карту под неё. */
const DEFAULT_WIDTH = 828;

const sectionWidth = (n: number) => n * UNIT + (n - 1) * UNIT_GAP;

/**
 * Разделы по строкам: целыми разделами, пока строка помещается в ширину. Раздел длиннее строки
 * встаёт один в свою строку и выходит за край — таких сейчас нет (самый длинный — 37 юнитов).
 */
function rows(sections: MapSection[], width: number): { sections: MapSection[]; used: number }[] {
    const out: { sections: MapSection[]; used: number }[] = [];
    for (const s of sections) {
        const w = sectionWidth(s.units.length);
        const row = out.at(-1);
        if (row && row.used + SECTION_GAP + w <= width) {
            row.sections.push(s);
            row.used += SECTION_GAP + w;
        } else {
            out.push({ sections: [s], used: w });
        }
    }
    return out;
}

/**
 * Карта книги: квадрат 3×3 на юнит, разделы — разрывами, строки — целыми разделами по ширине колонки.
 * Строка, занявшая не меньше ¾ ширины, растянута на всю (растут разрывы между разделами), кроме последней
 * из нескольких; остальные — разрывы фиксированные, прижаты влево. Клик ведёт к строке юнита: на этой странице
 * или, с base (путь страницы области), туда — строка подсветится при открытии (UnitRow).
 * С клавиатуры квадраты не достаются: те же строки ниже или на странице области, и 145 остановок по Tab — лишние.
 */
export function UnitMap({ sections, base = '' }: { sections: MapSection[]; base?: string }) {
    const all = sections.flatMap((s) => s.units);
    const count = (st: MapStatus) => all.filter((u) => u.status === st).length;
    const box = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState(DEFAULT_WIDTH);
    useEffect(() => {
        const el = box.current;
        if (!el) return;
        const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
        ro.observe(el);
        return () => ro.disconnect();
    }, []);
    const lines = rows(sections, width);
    const spread = (r: number) => lines[r].used >= width * SPREAD_FILL && (r < lines.length - 1 || lines.length === 1);
    return (
        <div ref={box} className="map" role="img" aria-label={`Освоено ${count('mastered')} из ${all.length}, в работе ${count('learning')}`}>
            {lines.map(({ sections: line }, r) => (
                <div key={line[0].key} className={`map__row${spread(r) ? ' map__row--spread' : ''}`}>
                    {line.map((s, i) => (
                        <div key={s.key} className={`map__section${i >= line.length / 2 ? ' map__section--end' : ''}`}
                            style={{ '--n': s.units.length } as CSSProperties}>
                            {s.units.map((u) => {
                                const href = `${base}#unit-${u.id}`;
                                return (
                                    <a key={u.id} href={href} tabIndex={-1} onClick={(e) => jump(e, href)}
                                        className={`map__unit map__unit--${u.status}`}
                                        data-tip={`${u.number ?? '—'}. ${u.title}\n${s.name} · ${WORD[u.status]}`} />
                                );
                            })}
                        </div>
                    ))}
                </div>
            ))}
        </div>
    );
}
