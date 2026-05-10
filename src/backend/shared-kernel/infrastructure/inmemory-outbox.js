/**
 * InMemoryOutbox — in-process implementation of the Outbox port for tests
 * and dev mode where there is no Postgres pool.
 *
 * Supports two append shapes used historically across the codebase:
 *   - Phase 0/Workflow: `enqueue(events: DomainEvent[], uowCtx?: object)`
 *     — pushes one row per event. Each row carries the canonical envelope
 *     fields produced by {@link DomainEvent#toJSON}.
 *   - Phase 4-6 supporting: `append(record)` / `fetchPending({batchSize})`
 *     / `markDispatched(id)` / `markFailed(id, err)` — used by the
 *     OutboxConsumer in the Notification context.
 *
 * Both surfaces operate on the same backing array so a producer using
 * `enqueue` is consumable by a `fetchPending` consumer.
 */
import { randomUUID } from 'node:crypto';

export class InMemoryOutbox {
  constructor() {
    this._records = [];
  }

  /* -------------------- Phase 0 / Workflow surface -------------------- */

  /**
   * Enqueue an array of DomainEvents. `uowCtx` is accepted for API
   * compatibility with the Postgres adapter and ignored here.
   * @param {Array<{ toJSON?: () => any }>} events
   */
  async enqueue(events /* , uowCtx */) {
    if (!Array.isArray(events)) {
      throw new TypeError('Outbox.enqueue: events must be an array');
    }
    for (const ev of events) {
      const e = typeof ev?.toJSON === 'function' ? ev.toJSON() : (ev ?? {});
      this._records.push({
        // Postgres-table-shaped row.
        id: e.eventId ?? randomUUID(),
        event_id: e.eventId ?? null,
        eventId: e.eventId ?? null,
        // The Phase 4-6 OutboxConsumer reads `record.type`; canonical events
        // use `eventType`. Mirror to both names so either consumer works.
        type: e.eventType ?? e.type ?? null,
        eventType: e.eventType ?? e.type ?? null,
        version: e.eventVersion ?? e.version ?? 1,
        eventVersion: e.eventVersion ?? e.version ?? 1,
        aggregateId: e.aggregateId ?? null,
        aggregateType: e.aggregateType ?? null,
        payload: e.payload ?? {},
        occurredAt: e.occurredAt ?? new Date().toISOString(),
        correlationId: e.correlationId ?? null,
        causationId: e.causationId ?? null,
        actor: e.actor ?? null,
        status: 'pending',
        attempts: 0,
        retry_count: 0,
      });
    }
  }

  /**
   * Pick a batch of pending rows. Mirrors the Postgres adapter; ignores
   * `uowCtx` and never blocks. Returns plain objects ready for the
   * Notification OutboxConsumer.
   * @param {number} size
   */
  async pickBatch(size /* , uowCtx */) {
    if (!Number.isInteger(size) || size <= 0) {
      throw new TypeError('Outbox.pickBatch: size must be a positive integer');
    }
    const out = [];
    for (const r of this._records) {
      if (r.status === 'pending') {
        out.push({ ...r });
        if (out.length >= size) break;
      }
    }
    return out;
  }

  /**
   * Mark a batch of rows as dispatched.
   * Accepts either `string` (single id) or `string[]` (batch).
   * @param {string|string[]} ids
   */
  async markDispatched(ids) {
    const list = Array.isArray(ids) ? ids : [ids];
    const now = new Date().toISOString();
    for (const id of list) {
      const r = this._records.find((x) => x.id === id || x.eventId === id);
      if (r) {
        r.status = 'dispatched';
        r.dispatchedAt = now;
      }
    }
  }

  /**
   * Mark a single row as failed; bumps attempts/retry_count.
   * @param {string} id
   * @param {string} reason
   */
  async markFailed(id, reason) {
    const r = this._records.find((x) => x.id === id || x.eventId === id);
    if (r) {
      r.attempts = (r.attempts ?? 0) + 1;
      r.retry_count = (r.retry_count ?? 0) + 1;
      r.lastError = String(reason ?? '');
      // Stay pending so the Phase 4-6 consumer can retry. The Postgres
      // adapter sets status='failed' and uses retry_count for backoff;
      // keeping it pending here matches the pre-migration behaviour of
      // shared/outbox/outbox-port.js's InMemoryOutbox.
      r.status = 'pending';
    }
  }

  /* ---------------- Phase 4-6 supporting surface ---------------- */

  /**
   * Append a single record (Phase 4-6 OutboxConsumer style).
   * @param {object} record
   */
  async append(record) {
    if (!record || typeof record !== 'object') {
      throw new TypeError('Outbox.append: record must be an object');
    }
    this._records.push({
      attempts: 0,
      retry_count: 0,
      status: 'pending',
      ...record,
    });
  }

  /**
   * Read pending records, FIFO, capped at `batchSize`.
   * @param {{batchSize?: number}} [opts]
   */
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

  /* ---------------- observability surface ---------------- */

  /**
   * Age of the oldest pending event in ms relative to `now`. Returns 0
   * when no pending records exist. Mirrors the Postgres adapter so the
   * `/health` probe can surface dispatch lag uniformly.
   * @param {Date} [now]
   */
  async getOldestPendingAge(now) {
    const ref = now instanceof Date ? now.getTime() : Date.now();
    let oldest = null;
    for (const r of this._records) {
      if (r.status !== 'pending') continue;
      const ts = Date.parse(r.occurredAt);
      if (Number.isFinite(ts) && (oldest === null || ts < oldest)) oldest = ts;
    }
    if (oldest === null) return 0;
    const age = ref - oldest;
    return age > 0 ? age : 0;
  }

  /** Number of pending records. */
  async getPendingCount() {
    let n = 0;
    for (const r of this._records) if (r.status === 'pending') n += 1;
    return n;
  }

  /** Test helper: return a copy of every record. */
  all() {
    return this._records.map((r) => ({ ...r }));
  }

  /** Test helper: clear the buffer. */
  clear() {
    this._records.length = 0;
  }
}
