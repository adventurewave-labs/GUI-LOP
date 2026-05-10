/**
 * UnitOfWork port — transactional boundary for repository writes.
 *
 * The application layer asks the factory for a UoW, performs writes through
 * it, and then commits. The default in-memory factory is a no-op: writes
 * happen immediately and `commit()` resolves. Postgres adapters wrap a
 * transaction.
 */
export class UnitOfWork {
  async commit() {}
  async rollback() {}
}

export class UnitOfWorkFactory {
  /** @returns {Promise<UnitOfWork>} */
  async start() { return new UnitOfWork(); }
}
