// Иконки рисуются руками (design.md): сетка 16×16, показ 14×14, обводка 1.4.
const PATHS = {
    play: <path d="M5 3.2v9.6L12.6 8z" />,
    ok: <path d="M3 8.4l3.2 3.2L13 4.8" />,
    cancel: <><path d="M4 4l8 8" /><path d="M12 4l-8 8" /></>,
    copy: <><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" /><path d="M10.5 3.5h-7a1.5 1.5 0 0 0-1.5 1.5v7" /></>,
    // Круглый чекбокс: пустой и с галочкой.
    check: <circle cx="8" cy="8" r="6" />,
    checked: <><circle cx="8" cy="8" r="6" /><path d="M5.3 8.2l1.9 1.9 3.5-3.8" /></>,
};

export type IconName = keyof typeof PATHS;

export function Icon({ name }: { name: IconName }) {
    return (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor"
            strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {PATHS[name]}
        </svg>
    );
}
