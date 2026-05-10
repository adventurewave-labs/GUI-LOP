export class ListSubscriptionsQuery {
  constructor({ subscriptionRepository }) {
    this._repo = subscriptionRepository;
  }

  async execute({ subscriberKind, subscriberRef } = {}) {
    if (subscriberKind && subscriberRef) {
      return this._repo.findBySubscriber(subscriberKind, subscriberRef);
    }
    return this._repo.findActive();
  }
}
