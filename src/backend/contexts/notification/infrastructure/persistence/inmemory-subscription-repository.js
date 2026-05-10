import { SubscriptionRepository } from '../../application/ports/subscription-repository.js';

export class InMemorySubscriptionRepository extends SubscriptionRepository {
  constructor() {
    super();
    this._byId = new Map();
  }

  async save(subscription) {
    this._byId.set(subscription.id, subscription);
  }

  async findById(id) {
    return this._byId.get(id) ?? null;
  }

  async findActive() {
    return [...this._byId.values()].filter((s) => s.isActive);
  }

  async findBySubscriber(kind, ref) {
    return [...this._byId.values()].filter(
      (s) => s.subscriberKind === kind && s.subscriberRef === ref
    );
  }

  async delete(id) {
    this._byId.delete(id);
  }

  /** Test helper. */
  size() {
    return this._byId.size;
  }
}
