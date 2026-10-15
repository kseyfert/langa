import 'server-only';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

// Глобал, а не переменная модуля: в dev Next перезагружает модули на каждую
// правку, и без него каждый раз открывался бы новый пул — session pooler кончился бы.
const g = globalThis as unknown as { db?: PostgresJsDatabase<typeof schema> };

/** Подключение создаётся при первом запросе, а не при импорте: сборке база не нужна. */
export function db(): PostgresJsDatabase<typeof schema> {
    if (g.db) return g.db;
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL не задан — см. .env.example');
    g.db = drizzle(postgres(url, { max: 5 }), { schema });
    return g.db;
}
