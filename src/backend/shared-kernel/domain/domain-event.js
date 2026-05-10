/**
 * DomainEvent base class — immutable past-tense fact about an aggregate.
 * Stub of Phase 0 shared kernel.
 */
export class DomainEvent {
  /**
   * @param {object} params
   * @param {string} params.eventType  e.g. "human_response.recorded"
   * @param {string} params.aggregateId
   * @param {string} params.aggregateType
   * @param {object} params.payload
   * @param {Date}   params.occurredAt
   * @param {string} [params.eventId]
   * @param {number} [params.eventVersion]
   * @param {string} [params.correlationId]
   * @param {string} [params.causationId]
   * @param {object} [params.actor]
   */
  constructor({
    eventType,
    aggregateId,
    aggregateType,
    payload,
    occurredAt,
    eventId,
    eventVersion = 1,
    correlationId,
    causationId,
    actor,
  }) {
    if (!eventType) throw new Error('DomainEvent: eventType is required');
    if (!aggregateId) throw new Error('DomainEvent: aggregateId is required');
    if (!aggregateType) throw new Error('DomainEvent: aggregateType is required');
    if (!occurredAt) throw new Error('DomainEvent: occurredAt is required');
    this.eventId = eventId;
    this.eventType = eventType;
    this.eventVersion = eventVersion;
    this.aggregateId = aggregateId;
    this.aggregateType = aggregateType;
    this.payload = payload ?? {};
    this.occurredAt = occurredAt instanceof Date ? occurredAt : new Date(occurredAt);
    this.correlationId = correlationId;
    this.causationId = causationId;
    this.actor = actor;
    Object.freeze(this);
    Object.freeze(this.payload);
  }
}
