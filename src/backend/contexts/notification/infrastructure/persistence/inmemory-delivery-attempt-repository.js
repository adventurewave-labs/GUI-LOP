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
    // Same contract as the Pg adapter: ordered by attempted_at (stable for ties).
    const t = (a) => new Date(a.attemptedAt ?? 0).getTime();
    return this._items
      .filter((a) => a.eventId === eventId)
      .map((a, i) => [a, i])
      .sort(([a, i], [b, j]) => t(a) - t(b) || i - j)
      .map(([a]) => a);
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
