/**
 * SubscriptionRepository port.
 */

export class SubscriptionRepository {
  async save(_subscription) {
    throw new Error('SubscriptionRepository.save is abstract');
  }

  async findById(_id) {
    throw new Error('SubscriptionRepository.findById is abstract');
  }

  async findActive() {
    throw new Error('SubscriptionRepository.findActive is abstract');
  }

  async findBySubscriber(_kind, _ref) {
    throw new Error('SubscriptionRepository.findBySubscriber is abstract');
  }

  async delete(_id) {
    throw new Error('SubscriptionRepository.delete is abstract');
  }
}
