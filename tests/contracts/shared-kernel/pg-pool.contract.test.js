/**
 * pg-pool contract (roadmap 21): the session limits configured in
 * pg-pool.js actually take effect on a real Postgres server, and the pool
 * survives the server killing its connections.
 */
import pg from 'pg';
import { describeIfDocker } from '../_helpers/docker-available.js';
import { startPostgres } from '../_fixtures/postgres.js';
import { createPgPool } from '../../../src/backend/shared-kernel/infrastructure/pg-pool.js';
import { loadConfig } from '../../../src/backend/shared-kernel/config/config-loader.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describeIfDocker('pg pool session safety (real Postgres)', () => {
  let fx;
  const pools = [];
  const make = (env = {}) => {
    const errors = [];
    const pool = createPgPool(pg.Pool, loadConfig({ JWT_SECRET: 'x', DATABASE_URL: fx.url, ...env }), { error: (m, meta) => errors.push(meta) });
    pools.push(pool);
    return { pool, errors };
  };

  beforeAll(async () => { fx = await startPostgres({ applyAnalytics: false }); }, 90_000);
  afterAll(async () => {
    await Promise.all(pools.map((p) => p.end().catch(() => {})));
    if (fx) await fx.cleanup();
  });

  test('limits are applied to every session as startup parameters', async () => {
    const { pool } = make({ DB_APPLICATION_NAME: 'gui-lop-contract' });
    const { rows } = await pool.query(`SELECT current_setting('statement_timeout') AS st,
      current_setting('lock_timeout') AS lt,
      current_setting('idle_in_transaction_session_timeout') AS itx,
      current_setting('application_name') AS app`);
    expect(rows[0]).toEqual({ st: '15s', lt: '5s', itx: '30s', app: 'gui-lop-contract' });
    const act = await pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name = 'gui-lop-contract'");
    expect(act.rows[0].n).toBeGreaterThanOrEqual(1);
  });

  test('statement_timeout cancels a runaway query (57014)', async () => {
    const { pool } = make({ DB_STATEMENT_TIMEOUT_MS: '200' });
    const t0 = Date.now();
    await expect(pool.query('SELECT pg_sleep(5)')).rejects.toMatchObject({ code: '57014' });
    expect(Date.now() - t0).toBeLessThan(2000);
    expect((await pool.query('SELECT 1 AS ok')).rows[0].ok).toBe(1); // pool still usable
  });

  test('lock_timeout bounds a wait on a held row lock (55P03)', async () => {
    const { pool } = make({ DB_LOCK_TIMEOUT_MS: '200' });
    await pool.query('CREATE TABLE IF NOT EXISTS pool_lock_probe (id int primary key)');
    await pool.query('INSERT INTO pool_lock_probe VALUES (1) ON CONFLICT DO NOTHING');
    const holder = await pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT * FROM pool_lock_probe WHERE id = 1 FOR UPDATE');
      await expect(pool.query('UPDATE pool_lock_probe SET id = 1 WHERE id = 1')).rejects.toMatchObject({ code: '55P03' });
    } finally {
      await holder.query('ROLLBACK');
      holder.release();
    }
  });

  test('an abandoned transaction is reaped by the server and the pool recovers', async () => {
    const { pool } = make({ DB_IDLE_IN_TX_TIMEOUT_MS: '200' });
    const leaked = await pool.connect();
    await leaked.query('BEGIN');
    await sleep(700); // handler "hung" with a transaction open
    await expect(leaked.query('SELECT 1')).rejects.toBeTruthy();
    leaked.release(true);
    expect((await pool.query('SELECT 1 AS ok')).rows[0].ok).toBe(1);
  });

  test('server-side termination of an idle client does not crash the process; next query reconnects', async () => {
    const { pool, errors } = make({ DB_APPLICATION_NAME: 'gui-lop-terminate' });
    await pool.query('SELECT 1');
    const admin = make({ DB_APPLICATION_NAME: 'gui-lop-admin' }).pool;
    await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'gui-lop-terminate'");
    await sleep(200);
    expect(errors.some((e) => e?.err?.code === '57P01')).toBe(true);
    expect((await pool.query('SELECT 2 AS ok')).rows[0].ok).toBe(2);
  });

  test('connection acquisition fails fast when the pool is exhausted', async () => {
    const { pool } = make({ DB_POOL_MAX: '1', DB_CONNECT_TIMEOUT_MS: '200' });
    const held = await pool.connect();
    try {
      const t0 = Date.now();
      await expect(pool.query('SELECT 1')).rejects.toThrow(/timeout/i);
      expect(Date.now() - t0).toBeLessThan(2000);
    } finally {
      held.release();
    }
  });
});
