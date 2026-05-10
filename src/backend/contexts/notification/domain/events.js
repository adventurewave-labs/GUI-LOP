import { DomainEvent } from '../../../shared/kernel/domain-event.js';

export class NotificationDelivered extends DomainEvent {
  constructor({ subscriptionId, eventId, channel, attemptNumber, occurredAt }) {
    super({
      type: 'notification.delivered',
      version: 1,
      aggregateId: subscriptionId,
      aggregateType: 'Subscription',
      payload: { subscriptionId, eventId, channel, attemptNumber },
      occurredAt
    });
  }
}

export class NotificationFailed extends DomainEvent {
  constructor({ subscriptionId, eventId, channel, attemptNumber, error, deadLettered, occurredAt }) {
    super({
      type: 'notification.failed',
      version: 1,
      aggregateId: subscriptionId,
      aggregateType: 'Subscription',
      payload: {
        subscriptionId,
        eventId,
        channel,
        attemptNumber,
        error,
        deadLettered: !!deadLettered
      },
      occurredAt
    });
  }
}
