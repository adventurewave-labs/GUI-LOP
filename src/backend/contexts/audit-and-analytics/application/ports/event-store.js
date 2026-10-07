// @ts-check
/**
 * EventStore — read-only port over the platform's `events` table.
 *
 * `query({ aggregateType, aggregateId, range })`
 *   range: { from?: ISOString, to?: ISOString, limit?: number, offset?: number }
 */

export class EventStore {
  /**
   * @param {any} [_filter]
   * @returns {Promise<any[]>}
   */
  async query(_filter) { throw new Error('EventStore.query is abstract'); }

  /**
   * Recompute the audit hash chain (adapters without one report `supported: false`).
   * @returns {Promise<{ supported: boolean, ok: boolean, entries: number, firstBrokenSeq: number|null, head: object|null }>}
   */
  async verifyChain() { throw new Error('EventStore.verifyChain is abstract'); }
}
