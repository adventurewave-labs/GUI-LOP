/**
 * pg-pool — option mapping, crash-safety listener, stats, /metrics gauge.
 * Real-server behaviour (timeouts actually firing) is in
 * tests/contracts/shared-kernel/pg-pool.contract.test.js.
 */
import { EventEmitter } from 'node:events';
import { pgPoolOptions, createPgPool, pgPoolStats } from '../pg-pool.js';
import { loadConfig } from '../../config/config-loader.js';
import { createMetrics } from '../../../bootstrap/metrics.js';

const base = { JWT_SECRET: 'x', DATABASE_URL: 'postgresql://u@h:5432/db' };

describe('pgPoolOptions', () => {
  test('safe defaults from config', () => {
    const o = pgPoolOptions(loadConfig(base));
    expect(o).toEqual({
      connectionString: 'postgresql://u@h:5432/db',
      application_name: 'gui-lop-api',
      max: 10,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 5000,
      maxLifetimeSeconds: 1800,
      keepAlive: true,
      statement_timeout: 15000,
      lock_timeout: 5000,
      idle_in_transaction_session_timeout: 30000,
      query_timeout: 20000,
    });
  });

  test('every knob is configurable; 0 disables the statement timeout and its client backstop', () => {
    const o = pgPoolOptions(loadConfig({
      ...base,
      DB_POOL_MAX: '25', DB_POOL_IDLE_TIMEOUT_MS: '1', DB_CONNECT_TIMEOUT_MS: '2', DB_POOL_MAX_LIFETIME_S: '0',
      DB_STATEMENT_TIMEOUT_MS: '0', DB_LOCK_TIMEOUT_MS: '3', DB_IDLE_IN_TX_TIMEOUT_MS: '4', DB_APPLICATION_NAME: 'worker',
    }));
    expect(o).toMatchObject({
      max: 25, idleTimeoutMillis: 1, connectionTimeoutMillis: 2, maxLifetimeSeconds: 0,
      statement_timeout: 0, lock_timeout: 3, idle_in_transaction_session_timeout: 4, application_name: 'worker',
    });
    expect(o.query_timeout).toBeUndefined();
  });

  test('non-numeric values are rejected by the config schema', () => {
    expect(() => loadConfig({ ...base, DB_POOL_MAX: 'lots' })).toThrow();
  });
});

describe('createPgPool', () => {
  class FakePool extends EventEmitter {
    constructor(opts) { super(); this.options = opts; }
  }

  test('an idle-client error is logged, not thrown (would crash the process)', () => {
    const errors = [];
    const pool = createPgPool(FakePool, loadConfig(base), { error: (m, meta) => errors.push([m, meta]) });
    expect(pool.options.statement_timeout).toBe(15000);
    expect(() => pool.emit('error', Object.assign(new Error('terminating connection due to administrator command'), { code: '57P01' }))).not.toThrow();
    expect(errors).toEqual([['postgres idle client error (client discarded)', { err: { message: 'terminating connection due to administrator command', code: '57P01' } }]]);
  });

  test('every new client gets its own error listener (checked-out clients are not guarded by pg-pool)', () => {
    const warns = [];
    const pool = createPgPool(FakePool, loadConfig(base), { warn: (m, meta) => warns.push([m, meta]) });
    const client = new EventEmitter();
    pool.emit('connect', client);
    expect(() => client.emit('error', Object.assign(new Error('terminating connection due to idle-in-transaction timeout'), { code: '25P03' }))).not.toThrow();
    expect(warns).toEqual([['postgres client error while checked out', { err: { message: 'terminating connection due to idle-in-transaction timeout', code: '25P03' } }]]);
  });

  test('without a listener the same event WOULD throw (why the listener matters)', () => {
    expect(() => new FakePool({}).emit('error', new Error('boom'))).toThrow('boom');
  });
});

describe('pgPoolStats + db_pool_connections gauge', () => {
  test('stats', () => {
    expect(pgPoolStats(null)).toBeNull();
    expect(pgPoolStats({ totalCount: 4, idleCount: 1, waitingCount: 2, options: { max: 10 } }))
      .toEqual({ total: 4, idle: 1, waiting: 2, max: 10 });
    expect(pgPoolStats({})).toEqual({ total: 0, idle: 0, waiting: 0, max: 0 });
  });

  test('exposed on /metrics by state; absent pool → no samples', async () => {
    const m = createMetrics({ defaultMetrics: false, dbPool: () => ({ total: 4, idle: 1, waiting: 2, max: 10 }) });
    const text = await m.registry.metrics();
    expect(text).toMatch(/db_pool_connections\{state="total"\} 4/);
    expect(text).toMatch(/db_pool_connections\{state="idle"\} 1/);
    expect(text).toMatch(/db_pool_connections\{state="waiting"\} 2/);
    expect(text).toMatch(/db_pool_connections\{state="max"\} 10/);

    const none = await createMetrics({ defaultMetrics: false, dbPool: () => null }).registry.metrics();
    expect(none).not.toMatch(/db_pool_connections\{/);
  });
});
