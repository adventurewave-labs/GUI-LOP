/**
 * Unsubscribe — deletes a subscription by id.
 */

import { Result } from '../../../../shared/kernel/result.js';
import { SubscriptionNotFound } from '../../domain/errors.js';

export class UnsubscribeCommand {
  constructor({ subscriptionRepository }) {
    this._repo = subscriptionRepository;
  }

  async execute({ id }) {
    const existing = await this._repo.findById(id);
    if (!existing) {
      return Result.fail(new SubscriptionNotFound(id));
    }
    await this._repo.delete(id);
    return Result.ok({ id });
  }
}
