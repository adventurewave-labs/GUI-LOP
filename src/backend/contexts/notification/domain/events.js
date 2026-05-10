/**
 * Domain events emitted by the Notification bounded context.
 *
 * Bridges Phase 4's compact event API (`type`/`version`) to the strict
 * Phase 0 DomainEvent envelope (`eventType`/`eventVersion`/`eventId`/...).
 */
import { randomUUID } from 'node:crypto';
import { DomainEvent } from '../../../shared-kernel/domain/domain-event.js';

function envelope({
  eventType,
  aggregateId,
  aggregateType,
  payload,
  occurredAt,
  correlationId,
  actor,
  eventId,
  eventVersion,
}) {
  return {
    eventId: eventId ?? randomUUID(),
    eventType,
    eventVersion: eventVersion ?? 1,
    occurredAt:
      occurredAt instanceof Date
        ? occurredAt.toISOString()
        : occurredAt ?? new Date().toISOString(),
    aggregateId,
    aggregateType,
    correlationId: correlationId ?? randomUUID(),
    actor: actor ?? { type: 'system' },
    payload: payload ?? {},
  };
}

export class NotificationDelivered extends DomainEvent {
  constructor({ subscriptionId, eventId, channel, attemptNumber, occurredAt, correlationId, actor }) {
    super(envelope({
      eventType: 'notification.delivered',
      aggregateId: subscriptionId,
      aggregateType: 'Subscription',
      payload: { subscriptionId, eventId, channel, attemptNumber },
      occurredAt,
      correlationId,
      actor,
    }));
  }
}

export class NotificationFailed extends DomainEvent {
  constructor({ subscriptionId, eventId, channel, attemptNumber, error, deadLettered, occurredAt, correlationId, actor }) {
    super(envelope({
      eventType: 'notification.failed',
      aggregateId: subscriptionId,
      aggregateType: 'Subscription',
      payload: {
        subscriptionId,
        eventId,
        channel,
        attemptNumber,
        error,
        deadLettered: !!deadLettered,
      },
      occurredAt,
      correlationId,
      actor,
    }));
  }
}
