/**
 * UnitOfWork port — runs a callback inside a single transaction so
 * aggregate writes and outbox enqueues commit atomically (ADR 0014).
 *
 * Interface:
 *   {
 *     run(fn: (ctx: { client: PgClient }) => Promise<T>): Promise<T>
 *   }
 *
 * Implementations BEGIN/COMMIT/ROLLBACK around `fn` and pass a
 * transactional client/handle in `ctx` for repositories to use.
 *
 * Convenience helper exposed for symmetry with the spec's
 * `runInTransaction(fn)` shape.
 */
export const UNIT_OF_WORK_PORT = Symbol.for('shared-kernel/UnitOfWork');

/**
 * Run `fn` inside `uow.run`. Sugar for callers that prefer the
 * `runInTransaction(uow, fn)` form documented in the migration guide.
 * @template T
 * @param {{ run: (fn: (ctx: any) => Promise<T>) => Promise<T> }} uow
 * @param {(ctx: any) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export function runInTransaction(uow, fn) {
  if (!uow || typeof uow.run !== 'function') {
    throw new TypeError('runInTransaction: uow must implement run()');
  }
  return uow.run(fn);
}
