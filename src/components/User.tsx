'use client';

import { useState } from 'react';
import './User.css';

function hash(s: string): number {
    let h = 0;
    for (const ch of s) h = (Math.imul(h, 31) + ch.codePointAt(0)!) | 0;
    return Math.abs(h);
}

/* Формулы общие для всей семьи AnkiBook: у одного имени один цвет и зверёк во всех инструментах. */
function tileColor(name: string): string {
    const h = hash(name);
    return `hsl(${(h % 12) * 30} 45% ${Math.floor(h / 12) % 2 ? 38 : 52}%)`;
}

export function User({ name }: { name: string }) {
    const [broken, setBroken] = useState(false);
    const src = `https://api.dicebear.com/10.x/critters/svg?tags=animation&seed=${encodeURIComponent(name)}`;
    return (
        <div className="user row">
            <span className="user__name">{name}</span>
            <span className="user__tile" style={{ background: tileColor(name) }} aria-hidden="true">
                {broken ? (
                    <span className="user__letter">{name.slice(0, 1).toUpperCase()}</span>
                ) : (
                    <img className="user__pic" src={src} alt="" onError={() => setBroken(true)} />
                )}
            </span>
        </div>
    );
}
