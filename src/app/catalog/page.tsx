import Link from 'next/link';
import { hasTasks, listUnits, listWorkspaces, type Unit, type Workspace } from '@/server/catalog';
import { unitStatus } from '@/components/unitStatus';
import { unitRatings, type UnitRating } from '@/server/learner';
import './Workspaces.css';

// Области и юниты правят в Table Editor — страница всегда читает базу заново.
export const dynamic = 'force-dynamic';

export default async function CatalogPage() {
    let workspaces: Workspace[];
    let unitsOf: Unit[][];
    let ratings: Map<number, UnitRating>;
    try {
        [workspaces, ratings] = await Promise.all([listWorkspaces(), unitRatings()]);
        // Областей единицы, юнитов сотни: по запросу на область проще отдельного агрегата.
        unitsOf = await Promise.all(workspaces.map((w) => listUnits(w.id)));
    } catch (e) {
        return (
            <div className="stack">
                <h1>Каталог</h1>
                <p className="banner">Не получилось прочитать каталог: {e instanceof Error ? e.message : String(e)}</p>
            </div>
        );
    }

    return (
        <div className="stack">
            <h1>Каталог</h1>
            {workspaces.length === 0 ? (
                <p className="hint muted">Рабочих областей пока нет. Заведи первую в Supabase Table Editor: таблица workspaces.</p>
            ) : (
                <ul className="spaces">
                    {workspaces.map((w, i) => {
                        const units = unitsOf[i];
                        // Те же статусы, что на карте области.
                        const statuses = units.map((u) => unitStatus(u.started, hasTasks(u), ratings.get(u.id)?.mastered ?? false));
                        const mastered = statuses.filter((s) => s === 'mastered').length;
                        const learning = statuses.filter((s) => s === 'learning').length;
                        return (
                            <li key={w.id}>
                                <Link href={`/workspace/${w.id}`} className="spaces__item">
                                    <span className="spaces__name">{w.name}</span>
                                    <span className="spaces__meta mono muted">
                                        юнитов {units.length} · в работе {learning} · освоено {mastered}
                                    </span>
                                </Link>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
