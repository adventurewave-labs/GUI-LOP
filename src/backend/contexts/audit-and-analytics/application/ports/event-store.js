/**
 * EventStore — read-only port over the platform's `events` table.
 *
 * `query({ aggregateType, aggregateId, range })`
 *   range: { from?: ISOString, to?: ISOString, limit?: number, offset?: number }
 */

export class EventStore {
  async query(_filter) { throw new Error('EventStore.query is abstract'); }
}
