// @ts-check
/**
 * pg-pool — the one place the application's Postgres pool is configured
 * (roadmap item 21 / P1).
 *
 * Before this the pool was `new Pool({ connectionString })`: unlimited query
 * time, no lock wait limit, a transaction left open by a crashed handler could
 * hold locks (and block vacuum) forever, connections were anonymous in
 * `pg_stat_activity`, acquiring a connection under load waited forever, and —
 * worst — no `'error'` listener on the pool, so a backend restart or network
 * blip on an *idle* client emitted an unhandled `'error'` event and crashed
 * the process.
 *
 * Server-side limits are sent as startup parameters, so they apply to every
 * connection without an extra round-trip and are visible in `SHOW`:
 *   statement_timeout                     — kills runaway queries
 *   lock_timeout                          — bounds waits on row/table locks
 *   idle_in_transaction_session_timeout   — reaps abandoned transactions
 *   application_name                      — attributes sessions/locks
 * `query_timeout` is the client-side backstop (network partition: the server
 * never answers, so statement_timeout never fires).
 *
 * Migrations do NOT use this pool (index builds legitimately run long).
 */

/**
 * @param {Record<string, any>} config  AppConfig (DB_* keys + DATABASE_URL)
 * @returns {Record<string, unknown>} options for `new pg.Pool(...)`
 */
export function pgPoolOptions(config) {
  const statementTimeout = config.DB_STATEMENT_TIMEOUT_MS;
  return {
    connectionString: config.DATABASE_URL,
    application_name: config.DB_APPLICATION_NAME,
    max: config.DB_POOL_MAX,
    idleTimeoutMillis: config.DB_POOL_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: config.DB_CONNECT_TIMEOUT_MS,
    maxLifetimeSeconds: config.DB_POOL_MAX_LIFETIME_S,
    keepAlive: true,
    statement_timeout: statementTimeout,
    lock_timeout: config.DB_LOCK_TIMEOUT_MS,
    idle_in_transaction_session_timeout: config.DB_IDLE_IN_TX_TIMEOUT_MS,
    // Client backstop fires only if the server's own timeout could not.
    query_timeout: statementTimeout > 0 ? statementTimeout + 5000 : undefined,
  };
}

/**
 * Create the pool and attach the listener that keeps an idle-client error
 * from taking the process down. pg-pool already discards the broken client;
 * the next checkout opens a fresh connection.
 *
 * @param {new (opts: any) => any} Pool
 * @param {Record<string, any>} config
 * @param {{ warn?: Function, error?: Function }} [logger]
 */
export function createPgPool(Pool, config, logger) {
  const pool = new Pool(pgPoolOptions(config));
  const meta = (/** @type {any} */ err) => ({ err: { message: err?.message, code: err?.code } });
  pool.on('error', (/** @type {any} */ err) => {
    logger?.error?.('postgres idle client error (client discarded)', meta(err));
  });
  // pg-pool only guards *idle* clients. A client that is checked out between
  // queries (inside a transaction, awaiting app code) and is killed by the
  // server — failover, restart, or idle_in_transaction_session_timeout doing
  // its job — emits 'error' on the client itself; unhandled, that crashes
  // the process (proven in the pg-pool contract suite). The in-flight work
  // still fails through its own query promise, and release() destroys the
  // dead client instead of returning it to the pool.
  pool.on('connect', (/** @type {any} */ client) => {
    client.on('error', (/** @type {any} */ err) => {
      logger?.warn?.('postgres client error while checked out', meta(err));
    });
  });
  return pool;
}

/**
 * Point-in-time pool statistics for /metrics.
 * @param {{ totalCount?: number, idleCount?: number, waitingCount?: number, options?: { max?: number } } | null} pool
 */
export function pgPoolStats(pool) {
  if (!pool) return null;
  return {
    total: Number(pool.totalCount ?? 0),
    idle: Number(pool.idleCount ?? 0),
    waiting: Number(pool.waitingCount ?? 0),
    max: Number(pool.options?.max ?? 0),
  };
}
