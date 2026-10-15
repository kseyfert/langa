import type { MouseEvent } from 'react';

// Переход к юниту на странице каталога: из «опирается на» и из разбора ответа.

const FLASH = 'catalog__unit--flash';

/**
 * Подсветка классом, а не :target: :target не срабатывает повторно, если
 * ссылка ведёт туда же, куда и прошлая, — а на один юнит ссылаются многие.
 */
export function flash(el: HTMLElement) {
    el.classList.remove(FLASH);
    void el.offsetWidth; // перезапуск анимации, если строка уже мигала
    el.classList.add(FLASH);
    el.addEventListener('animationend', () => el.classList.remove(FLASH), { once: true });
}

/** Переход к юниту на этой же странице; прокрутка плавная за счёт scroll-behavior в base.css. */
export function jump(e: MouseEvent<HTMLAnchorElement>, href: string) {
    if (!href.startsWith('#')) return;
    const el = document.getElementById(href.slice(1));
    if (!el) return;
    e.preventDefault();
    history.pushState(null, '', href);
    el.scrollIntoView({ block: 'start' });
    flash(el);
}
