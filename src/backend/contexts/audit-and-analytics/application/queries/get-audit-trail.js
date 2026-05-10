/**
 * GetAuditTrail — generic audit trail by aggregate.
 */

export class GetAuditTrailQuery {
  constructor({ eventStore, auditLogStore }) {
    this._events = eventStore;
    this._logs = auditLogStore;
  }

  async execute({ aggregateType, aggregateId, range }) {
    const [events, logs] = await Promise.all([
      this._events.query({ aggregateType, aggregateId, range }),
      this._logs.query({ aggregateType, aggregateId, range })
    ]);
    return { aggregateType, aggregateId, events, logs };
  }
}
