import { loadEnvConfig } from '@next/env';
import { defineConfig } from 'drizzle-kit';

// Те же .env-файлы, что читает Next, чтобы DATABASE_URL жил в одном месте.
loadEnvConfig(process.cwd());

export default defineConfig({
    dialect: 'postgresql',
    schema: './src/server/db/schema.ts',
    out: './drizzle',
    dbCredentials: { url: process.env.DATABASE_URL! },
});
