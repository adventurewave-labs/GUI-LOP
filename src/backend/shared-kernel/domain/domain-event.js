import { ValidationError } from './errors.js';

/**
 * DomainEvent — base class for every event emitted by an aggregate.
 * Validates required envelope fields in the constructor.
 */
export class DomainEvent {
  /**
   * @param {object} props
   * @param {string} props.eventId         UUID v4 of this event instance.
   * @param {string} props.eventType       Stable type name, e.g. "WorkflowStarted".
   * @param {number} props.eventVersion    Schema version (>= 1).
   * @param {string} props.occurredAt      ISO-8601 timestamp.
   * @param {string} props.aggregateId     UUID of the source aggregate.
   * @param {string} props.aggregateType   Aggregate class name.
   * @param {string} props.correlationId   UUID linking related events.
   * @param {string} [props.causationId]   UUID of the event that caused this one.
   * @param {object} props.actor           { id, type } describing who triggered.
   * @param {object} props.payload         Event-specific data.
   */
  constructor(props) {
    if (!props || typeof props !== 'object') {
      throw new ValidationError('DomainEvent requires a props object');
    }
    const required = [
      'eventId',
      'eventType',
      'eventVersion',
      'occurredAt',
      'aggregateId',
      'aggregateType',
      'correlationId',
      'actor',
      'payload',
    ];
    for (const key of required) {
      if (props[key] === undefined || props[key] === null) {
        throw new ValidationError(`DomainEvent missing required field: ${key}`, {
          field: key,
        });
      }
    }
    if (typeof props.eventVersion !== 'number' || props.eventVersion < 1) {
      throw new ValidationError('DomainEvent.eventVersion must be a number >= 1');
    }
    if (typeof props.actor !== 'object') {
      throw new ValidationError('DomainEvent.actor must be an object');
    }
    if (typeof props.payload !== 'object') {
      throw new ValidationError('DomainEvent.payload must be an object');
    }

    this.eventId = props.eventId;
    this.eventType = props.eventType;
    this.eventVersion = props.eventVersion;
    this.occurredAt = props.occurredAt;
    this.aggregateId = props.aggregateId;
    this.aggregateType = props.aggregateType;
    this.correlationId = props.correlationId;
    this.causationId = props.causationId ?? null;
    this.actor = props.actor;
    this.payload = props.payload;
    Object.freeze(this);
  }

  /** Plain-object representation suitable for JSON serialisation / outbox writes. */
  toJSON() {
    return {
      eventId: this.eventId,
      eventType: this.eventType,
      eventVersion: this.eventVersion,
      occurredAt: this.occurredAt,
      aggregateId: this.aggregateId,
      aggregateType: this.aggregateType,
      correlationId: this.correlationId,
      causationId: this.causationId,
      actor: this.actor,
      payload: this.payload,
    };
  }
}
