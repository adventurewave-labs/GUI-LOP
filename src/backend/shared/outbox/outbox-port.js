/**
 * Outbox port (Phase-0 contract from ADR-0014).
 *
 * An OutboxRecord is:
 *   { id, aggregateType, aggregateId, type, version, payload, occurredAt, status, attempts }
 *
 * Implementations must be transactionally consistent with the aggregate's write store.
 */

export class OutboxPort {
  /**
   * Append a new event row inside the same DB transaction as the aggregate write.
   * @param {object} _record
   * @returns {Promise<void>}
   */
  async append(_record) {
    throw new Error('OutboxPort.append is abstract');
  }

  /**
   * Fetch a batch of pending records, optionally locking them for processing.
   * @param {{batchSize: number}} _opts
   * @returns {Promise<Array<object>>}
   */
  async fetchPending(_opts) {
    throw new Error('OutboxPort.fetchPending is abstract');
  }

  /**
   * Mark a record as successfully dispatched.
   * @param {string} _id
   */
  async markDispatched(_id) {
    throw new Error('OutboxPort.markDispatched is abstract');
  }

  /**
   * Mark a record as failed; should bump attempt counter.
   * @param {string} _id
   * @param {string} _error
   */
  async markFailed(_id, _error) {
    throw new Error('OutboxPort.markFailed is abstract');
  }
}

/**
 * In-memory outbox for tests and the supporting-context default wiring.
 */
export class InMemoryOutbox extends OutboxPort {
  constructor() {
    super();
    this._records = [];
  }

  async append(record) {
    this._records.push({
      attempts: 0,
      status: 'pending',
      ...record
    });
  }

  async fetchPending({ batchSize = 10 } = {}) {
    const out = [];
    for (const r of this._records) {
      if (r.status === 'pending') {
        out.push({ ...r });
        if (out.length >= batchSize) break;
      }
    }
    return out;
  }

  async markDispatched(id) {
    const r = this._records.find((x) => x.id === id);
    if (r) {
      r.status = 'dispatched';
      r.dispatchedAt = new Date().toISOString();
    }
  }

  async markFailed(id, error) {
    const r = this._records.find((x) => x.id === id);
    if (r) {
      r.attempts = (r.attempts ?? 0) + 1;
      r.lastError = error;
      r.status = 'pending';
    }
  }

  /** Test helper. */
  all() {
    return this._records.map((r) => ({ ...r }));
  }
}
