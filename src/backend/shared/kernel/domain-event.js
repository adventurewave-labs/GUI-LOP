/**
 * Base DomainEvent. Stub for Phase-0 shared kernel.
 */

import { randomUUID } from 'crypto';

export class DomainEvent {
  constructor({ type, version = 1, aggregateId, aggregateType, payload = {}, occurredAt, eventId } = {}) {
    if (!type) {
      throw new Error('DomainEvent requires a type');
    }
    this.eventId = eventId ?? randomUUID();
    this.type = type;
    this.version = version;
    this.aggregateId = aggregateId ?? null;
    this.aggregateType = aggregateType ?? null;
    this.payload = Object.freeze({ ...payload });
    this.occurredAt = occurredAt ?? new Date().toISOString();
    Object.freeze(this);
  }

  toJSON() {
    return {
      eventId: this.eventId,
      type: this.type,
      version: this.version,
      aggregateId: this.aggregateId,
      aggregateType: this.aggregateType,
      payload: this.payload,
      occurredAt: this.occurredAt
    };
  }
}
