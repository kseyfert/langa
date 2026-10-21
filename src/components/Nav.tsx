'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// match — разделы, где пункт подсвечен: область открывается из каталога и остаётся его частью.
const ITEMS = [{ href: '/catalog', label: 'Каталог', match: ['/catalog', '/workspace'] }];

export function Nav() {
    const path = usePathname();
    return (
        <nav className="steps" aria-label="Разделы">
            {ITEMS.map((it) => {
                const now = it.match.some((m) => path === m || path.startsWith(`${m}/`));
                return (
                    <Link
                        key={it.href}
                        href={it.href}
                        className={`steps__item${now ? ' steps__item--now' : ''}`}
                        aria-current={now ? 'page' : undefined}
                    >
                        {it.label}
                    </Link>
                );
            })}
        </nav>
    );
}
