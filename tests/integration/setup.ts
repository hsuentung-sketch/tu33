import 'dotenv/config';
import { beforeAll, afterAll, beforeEach } from 'vitest';
import { execSync } from 'node:child_process';
import { Client } from 'pg';

/**
 * Integration-test setup.
 *
 * Uses TEST_DATABASE_URL (falls back to a local Docker Postgres default).
 * On first run it:
 *   1. points Prisma at the test DB
 *   2. creates pg_trgm extension
 *   3. pushes the schema (db push — no migration history needed for tests)
 *   4. truncates all tables before each test
 */

const TEST_DB =
  process.env.TEST_DATABASE_URL ??
  'postgresql://erp:erp@localhost:5433/erp_test?schema=public';

// Override DATABASE_URL *before* any module imports prisma.
process.env.DATABASE_URL = TEST_DB;

let prisma: typeof import('../../src/shared/prisma.js').prisma;

beforeAll(async () => {
  // Ensure pg_trgm extension exists using a raw pg client (Prisma 7's
  // `db execute` no longer accepts --schema, and we want to avoid that anyway).
  const pg = new Client({ connectionString: TEST_DB });
  await pg.connect();
  await pg.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
  await pg.end();

  // Push schema (accept data loss — this is a test DB).
  execSync(`npx prisma db push --force-reset --accept-data-loss`, {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: TEST_DB },
  });

  const mod = await import('../../src/shared/prisma.js');
  prisma = mod.prisma;
});

beforeEach(async () => {
  // Fast truncate: list user tables then TRUNCATE CASCADE.
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'
  `;
  if (tables.length === 0) return;
  const joined = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE ${joined} RESTART IDENTITY CASCADE;`);
});

afterAll(async () => {
  if (prisma) await prisma.$disconnect();
});
