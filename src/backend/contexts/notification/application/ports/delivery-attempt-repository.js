/**
 * DeliveryAttemptRepository port.
 */

export class DeliveryAttemptRepository {
  async record(_attempt) {
    throw new Error('DeliveryAttemptRepository.record is abstract');
  }

  async listForEvent(_eventId) {
    throw new Error('DeliveryAttemptRepository.listForEvent is abstract');
  }

  async countForSubscription(_subscriptionId, _eventId) {
    throw new Error('DeliveryAttemptRepository.countForSubscription is abstract');
  }
}
