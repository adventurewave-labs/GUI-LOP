import { DomainError } from '../../../shared/kernel/errors.js';

export class SubscriptionNotFound extends DomainError {
  constructor(id) {
    super('SUBSCRIPTION_NOT_FOUND', `Subscription not found: ${id}`, { id });
  }
}

export class DeadLetterNotFound extends DomainError {
  constructor(id) {
    super('DEAD_LETTER_NOT_FOUND', `Dead-letter record not found: ${id}`, { id });
  }
}

export class DeliveryError extends DomainError {
  constructor(message, details = {}) {
    super('DELIVERY_ERROR', message, details);
  }
}
