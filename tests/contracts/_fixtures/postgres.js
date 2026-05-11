/**
 * Per-suite Postgres testcontainer fixture.
 *
 * Boots a Postgres 15 container, applies every migration under
 * `database/migrations/` and the OLAP-shaped `events`/`audit_logs`
 * projections, exposes a connected `pg.Pool`, and tears the whole
 * thing down on `cleanup()`.
 *
 * Per-file lifetime (one container per test file) keeps the fixture
 * simple at the cost of ~3-5 s container startup per file. With
 * `maxWorkers: 1` (set in jest.contracts.config.js) the total
 * runtime is bounded.
 *
 * Caller pattern:
 *
 *   let pg;
 *   beforeAll(async () => { pg = await startPostgres(); });
 *   afterAll(async () => { await pg.cleanup(); });
 *   beforeEach(async () => { await pg.truncate(); });
 */

import { applyMigrations, applyAnalyticsProjections } from '../_helpers/apply-migrations.js';
import { truncateAll } from '../_helpers/cleanup.js';

export const POSTGRES_IMAGE = 'postgres:15-alpine';

/**
 * Boot a Postgres testcontainer and return an interface for tests.
 *
 * The function does **not** check Docker availability — callers should
 * gate the surrounding `describe` via `describeIfDocker`, which means
 * we only get here when Docker is reachable. If the container start
 * does throw (e.g. transient daemon failure), the error propagates
 * unchanged so Jest reports a clean failure.
 */
export async function startPostgres(opts = {}) {
  // Dynamic import so test files that get fully skipped (no Docker)
  // never load testcontainers — saves a noisy import in the
  // skipped-output path.
  const tcMod = await import('@testcontainers/postgresql');
  const pgMod = await import('pg');
  const PostgreSqlContainer = tcMod.PostgreSqlContainer;
  const Pool = pgMod.Pool ?? pgMod.default?.Pool;

  const image = opts.image ?? POSTGRES_IMAGE;
  const container = await new PostgreSqlContainer(image)
    .withDatabase('contracts')
    .withUsername('contracts')
    .withPassword('contracts')
    .start();

  const url = container.getConnectionUri();
  const pool = new Pool({ connectionString: url, max: 8 });

  await applyMigrations(pool, { logger: { warn: () => {}, info: () => {} } });
  if (opts.applyAnalytics !== false) {
    await applyAnalyticsProjections(pool);
  }

  let stopped = false;
  return {
    pool,
    getPool: () => pool,
    url,
    container,
    async truncate() {
      await truncateAll(pool);
    },
    async applyMigrations() {
      await applyMigrations(pool);
    },
    async cleanup() {
      if (stopped) return;
      stopped = true;
      try { await pool.end(); } catch { /* swallow */ }
      try { await container.stop({ timeout: 5_000 }); } catch { /* swallow */ }
    },
  };
}
