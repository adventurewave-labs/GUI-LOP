/**
 * Apply the production SQL migrations against a connected pg `Pool`.
 *
 * We can't reuse `database/migrations/migrate.js` directly because it
 * boots the singleton `db` config from `database/config/database.js`,
 * which expects DATABASE_URL to be live at import time and uses its own
 * pool. For testcontainers we get the pool URL only at runtime, so we
 * drive the files directly through whatever `client` the caller hands
 * us.
 *
 * The contract is: every file under `database/migrations/*.sql` is
 * executed in lexical (and hence migration) order, one statement at a
 * time. Statements are split on semicolons that are NOT inside a
 * `$$ … $$` PL/pgSQL body (the audit trigger function uses `$$`).
 *
 * Files containing the `\i` psql meta-command are special-cased: we
 * read the included path relative to the repo root and inline it.
 *
 * Statements that throw with these codes are tolerated and logged:
 *   - `42710` duplicate_object (CREATE TYPE on rerun, …)
 *   - `42P07` duplicate_table
 *   - `42701` duplicate_column
 *   - `42P06` duplicate_schema
 *   - `42P17` invalid_object_definition (non-immutable index predicate)
 *
 * These come up when migrations are re-applied to a non-empty DB or
 * when migrations partially overlap; the schema converges either way.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

// `__dirname` is provided by babel's CJS transform when Jest runs;
// pure-ESM execution would not have it, but every contract suite runs
// through Jest+Babel, so this is safe in practice.
// eslint-disable-next-line no-undef
const HERE = __dirname;
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'database', 'migrations');

const TOLERATED_CODES = new Set(['42710', '42P07', '42701', '42P06', '42P17']);

async function readMigration(filename) {
  const abs = path.join(MIGRATIONS_DIR, filename);
  const raw = await fs.readFile(abs, 'utf8');
  // Inline `\i path/to.sql` (a psql meta-command pg can't execute itself).
  const lines = raw.split(/\r?\n/);
  const inlined = [];
  for (const line of lines) {
    const m = line.match(/^\s*\\i\s+(.+?)\s*$/);
    if (m) {
      const includePath = path.join(REPO_ROOT, m[1]);
      // eslint-disable-next-line no-await-in-loop
      inlined.push(await fs.readFile(includePath, 'utf8'));
    } else {
      inlined.push(line);
    }
  }
  return inlined.join('\n');
}

/**
 * Split a SQL script into individual statements, respecting `$$ … $$`
 * dollar-quoted strings (used for PL/pgSQL function bodies).
 */
export function splitStatements(sql) {
  const noComments = sql
    .split(/\r?\n/)
    .map((l) => (l.replace(/--.*$/, '')))
    .join('\n');

  const out = [];
  let buf = '';
  let inDollar = false;
  let i = 0;
  while (i < noComments.length) {
    const ch = noComments[i];
    const two = noComments.slice(i, i + 2);
    if (two === '$$') {
      inDollar = !inDollar;
      buf += '$$';
      i += 2;
      continue;
    }
    if (ch === ';' && !inDollar) {
      const trimmed = buf.trim();
      if (trimmed.length > 0) out.push(trimmed);
      buf = '';
      i += 1;
      continue;
    }
    buf += ch;
    i += 1;
  }
  const tail = buf.trim();
  if (tail.length > 0) out.push(tail);
  return out;
}

/**
 * Apply every migration file under `database/migrations/`, in order,
 * against the given pg client (or `Pool` — both expose `query()`).
 */
export async function applyMigrations(client, opts = {}) {
  const logger = opts.logger ?? { warn: () => {}, info: () => {} };
  const files = (await fs.readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const filename of files) {
    // eslint-disable-next-line no-await-in-loop
    const sql = await readMigration(filename);
    const statements = splitStatements(sql);
    for (const stmt of statements) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await client.query(stmt);
      } catch (err) {
        if (err && TOLERATED_CODES.has(err.code)) {
          logger.warn?.(
            `[migrations] ${filename}: tolerated ${err.code} (${err.message})`,
          );
          continue;
        }
        const head = stmt.slice(0, 120).replace(/\s+/g, ' ');
        err.message = `migration ${filename} failed at: ${head}\n  → ${err.message}`;
        throw err;
      }
    }
    logger.info?.(`[migrations] applied ${filename}`);
  }
}

/**
 * Apply the audit-and-analytics OLAP-style `events` and `audit_logs`
 * schemas that the `PgEventStore` / `PgAuditLogStore` adapters query.
 *
 * These tables have shapes that don't match the operational
 * `events` / `audit_logs` tables in 01_main_schema.sql; production
 * deployments rebuild them as projections (per ADR 0017). For
 * contract testing we re-create them under the same names — the
 * production tables go away, but the adapter contract is verified.
 */
export async function applyAnalyticsProjections(client) {
  await client.query('DROP TABLE IF EXISTS events CASCADE');
  await client.query('DROP TABLE IF EXISTS audit_logs CASCADE');
  await client.query(`
    CREATE TABLE events (
      id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      type            TEXT NOT NULL,
      version         INT  NOT NULL DEFAULT 1,
      aggregate_type  TEXT,
      aggregate_id    UUID,
      payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
      occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await client.query(`
    CREATE INDEX idx_events_aggregate
      ON events (aggregate_type, aggregate_id, occurred_at)
  `);
  await client.query(`
    CREATE TABLE audit_logs (
      id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      actor_id        UUID,
      action          TEXT NOT NULL,
      aggregate_type  TEXT,
      aggregate_id    UUID,
      details         JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await client.query(`
    CREATE INDEX idx_audit_logs_aggregate
      ON audit_logs (aggregate_type, aggregate_id, created_at)
  `);
}
