import { listUnits, searchUnits, type Unit } from '@/server/catalog';
import './Catalog.css';

// Каталог правят в Table Editor — страница всегда читает базу заново.
export const dynamic = 'force-dynamic';

type Group = { key: string; book: string; section: string; units: Unit[] };

/** Подряд идущие юниты одного раздела — одна группа; порядок задаёт position. */
function groupBySection(units: Unit[]): Group[] {
    const groups: Group[] = [];
    for (const u of units) {
        const last = groups.at(-1);
        if (last && last.book === u.book && last.section === u.section) last.units.push(u);
        else groups.push({ key: `${u.book}/${u.section}/${u.position}`, book: u.book, section: u.section, units: [u] });
    }
    return groups;
}

function plural(n: number, one: string, few: string, many: string): string {
    const m10 = n % 10, m100 = n % 100;
    const w = m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
    return `${n} ${w}`;
}

export default async function CatalogPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
    const q = ((await searchParams).q ?? '').trim();

    let units: Unit[];
    try {
        units = q ? await searchUnits(q) : await listUnits();
    } catch (e) {
        return (
            <div className="stack">
                <h1>Каталог</h1>
                <p className="banner">Не получилось прочитать каталог: {e instanceof Error ? e.message : String(e)}</p>
            </div>
        );
    }

    const groups = groupBySection(units);
    const sections = new Set(units.map((u) => `${u.book}/${u.section}`)).size;

    return (
        <div className="stack">
            <div>
                <h1>Каталог</h1>
                {units.length > 0 && (
                    <p className="hint muted">
                        {q ? 'нашлось ' : ''}
                        <span className="mono">{plural(units.length, 'юнит', 'юнита', 'юнитов')}</span>
                        {' · '}
                        <span className="mono">{plural(sections, 'раздел', 'раздела', 'разделов')}</span>
                    </p>
                )}
            </div>

            <form className="row" action="/catalog" role="search">
                <input
                    className="input catalog__search"
                    type="search"
                    name="q"
                    defaultValue={q}
                    placeholder="номер, название или тема"
                    aria-label="Поиск по каталогу"
                />
                <button className="btn" type="submit">Найти</button>
                {q && <a className="btn btn--quiet catalog__reset" href="/catalog">Сбросить</a>}
            </form>

            {units.length === 0 ? (
                <p className="hint muted">
                    {q ? 'Ничего не нашлось' : 'Каталог пуст. Оглавление загрузим отдельным шагом.'}
                </p>
            ) : (
                groups.map((g) => (
                    <section key={g.key}>
                        <h2>{g.section}</h2>
                        <ul className="catalog__list">
                            {g.units.map((u) => (
                                <li key={u.id} className="catalog__unit">
                                    <span className="catalog__num mono">{u.number ?? '—'}</span>
                                    <div>
                                        <div className="catalog__title">{u.title}</div>
                                        {u.summaryRu && <p className="hint muted">{u.summaryRu}</p>}
                                    </div>
                                </li>
                            ))}
                        </ul>
                    </section>
                ))
            )}
        </div>
    );
}
