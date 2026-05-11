/**
 * pg-unit-of-work — wraps a `pg` Pool in BEGIN/COMMIT/ROLLBACK and
 * exposes the transactional client to repositories via the ctx argument.
 *
 * Usage:
 *   const uow = createPgUnitOfWork(pool);
 *   await uow.run(async ({ client }) => {
 *     await repo.save(agg, client);
 *     await outbox.enqueue(events, { client });
 *   });
 */

/**
 * Build a UnitOfWork bound to the given pg Pool.
 * @param {{ connect: () => Promise<any> }} pool
 */
export function createPgUnitOfWork(pool) {
  if (!pool || typeof pool.connect !== 'function') {
    throw new TypeError('createPgUnitOfWork: pool must implement connect()');
  }
  return {
    /**
     * Run `fn` inside a transaction; commits on resolve, rolls back on reject.
     * @template T
     * @param {(ctx: { client: any }) => Promise<T>} fn
     * @returns {Promise<T>}
     */
    async run(fn) {
      if (typeof fn !== 'function') {
        throw new TypeError('UnitOfWork.run: fn must be a function');
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn({ client });
        await client.query('COMMIT');
        return result;
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch {
          /* swallow rollback failure; original error is more useful */
        }
        throw err;
      } finally {
        client.release();
      }
    },
  };
}
