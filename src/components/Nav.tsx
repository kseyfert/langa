'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [{ href: '/catalog', label: 'Каталог' }];

export function Nav() {
    const path = usePathname();
    return (
        <nav className="steps" aria-label="Разделы">
            {ITEMS.map((it) => {
                const now = path === it.href || path.startsWith(`${it.href}/`);
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
