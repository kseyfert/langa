import { marked } from 'marked';
import { listUnits, type Unit } from '@/server/catalog';
import { unitRatings, type UnitRating } from '@/server/learner';
import { UnitRow, type Dep } from './UnitRow';
import './Catalog.css';

// Каталог правят в Table Editor — страница всегда читает базу заново.
export const dynamic = 'force-dynamic';

// key — position первого юнита группы: одна книга или раздел может встретиться
// несколько раз, так что название ключом быть не может.
type Section = { key: number; name: string; units: Unit[] };
type Book = { key: number; name: string; sections: Section[] };

/**
 * Книга → раздел → юниты по порядку position. Группа — подряд идущие юниты:
 * юнит другой книги на позиции 45 разрывает книгу, и после него её заголовок
 * появляется снова. Порядок задаёт только position, а не принадлежность.
 */
function groupByBook(units: Unit[]): Book[] {
    const books: Book[] = [];
    for (const u of units) {
        let book = books.at(-1);
        if (!book || book.name !== u.book) books.push((book = { key: u.position, name: u.book, sections: [] }));
        const section = book.sections.at(-1);
        if (section && section.name === u.section) section.units.push(u);
        else book.sections.push({ key: u.position, name: u.section, units: [u] });
    }
    return books;
}

function plural(n: number, one: string, few: string, many: string): string {
    const m10 = n % 10, m100 = n % 100;
    const w = m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
    return `${n} ${w}`;
}

export default async function CatalogPage() {
    let units: Unit[];
    let ratings: Map<number, UnitRating>;
    try {
        [units, ratings] = await Promise.all([listUnits(), unitRatings()]);
    } catch (e) {
        return (
            <div className="stack">
                <h1>Каталог</h1>
                <p className="banner">Не получилось прочитать каталог: {e instanceof Error ? e.message : String(e)}</p>
            </div>
        );
    }

    const byId = new Map(units.map((u) => [u.id, u]));
    // Юнит есть в базе — якорь на его строку; нет — только id, без ссылки.
    const depsOf = (u: Unit): Dep[] =>
        u.buildsOn.map((id) => {
            const d = byId.get(id);
            return d ? { id, title: d.title, href: `#unit-${id}` } : { id, title: null, href: null };
        });

    const books = groupByBook(units);
    // Счётчики — по уникальным названиям: разорванная книга остаётся одной книгой.
    const bookCount = new Set(units.map((u) => u.book)).size;
    const sections = new Set(units.map((u) => `${u.book}/${u.section}`)).size;

    return (
        <div className="stack">
            <div>
                <h1>Каталог</h1>
                {units.length > 0 && (
                    <p className="hint muted">
                        <span className="mono">{plural(units.length, 'юнит', 'юнита', 'юнитов')}</span>
                        {' · '}
                        <span className="mono">{plural(sections, 'раздел', 'раздела', 'разделов')}</span>
                        {' · '}
                        <span className="mono">{plural(bookCount, 'книга', 'книги', 'книг')}</span>
                    </p>
                )}
            </div>

            {units.length === 0 ? (
                <p className="hint muted">
                    Каталог пуст. Загрузи юниты: npm run import:units -- файл.csv
                </p>
            ) : (
                books.map((b) => (
                    <section key={b.key} className="catalog__book">
                        <h2 className="catalog__book-title">{b.name}</h2>
                        {b.sections.map((s) => (
                            <section key={s.key} className="catalog__section">
                                <h3 className="catalog__section-title">{s.name}</h3>
                                <ul className="catalog__list">
                                    {s.units.map((u) => (
                                        <UnitRow
                                            key={u.id}
                                            id={u.id}
                                            number={u.number}
                                            title={u.title}
                                            summaryRu={u.summaryRu}
                                            guideHtml={u.guide.trim() ? marked.parse(u.guide, { async: false }) : null}
                                            deps={depsOf(u)}
                                            rating={ratings.get(u.id) ?? null}
                                        />
                                    ))}
                                </ul>
                            </section>
                        ))}
                    </section>
                ))
            )}
        </div>
    );
}
