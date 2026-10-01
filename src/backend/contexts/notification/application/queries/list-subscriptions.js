// @ts-check
export class ListSubscriptionsQuery {
  constructor({ subscriptionRepository }) {
    this._repo = subscriptionRepository;
  }

  /** @param {{ subscriberKind?: string, subscriberRef?: string }} [q] */
  async execute({ subscriberKind, subscriberRef } = {}) {
    if (subscriberKind && subscriberRef) {
      return this._repo.findBySubscriber(subscriberKind, subscriberRef);
    }
    return this._repo.findActive();
  }
}
