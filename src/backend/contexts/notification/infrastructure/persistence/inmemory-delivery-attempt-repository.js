import { DeliveryAttemptRepository } from '../../application/ports/delivery-attempt-repository.js';

export class InMemoryDeliveryAttemptRepository extends DeliveryAttemptRepository {
  constructor() {
    super();
    this._items = [];
  }

  async record(attempt) {
    this._items.push({ ...attempt });
  }

  async listForEvent(eventId) {
    return this._items.filter((a) => a.eventId === eventId);
  }

  async countForSubscription(subscriptionId, eventId) {
    return this._items.filter(
      (a) => a.subscriptionId === subscriptionId && a.eventId === eventId
    ).length;
  }

  /** Test helper. */
  all() {
    return [...this._items];
  }
}
