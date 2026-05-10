/**
 * Subscribe command — creates a new active Subscription and persists it.
 */

import { Subscription } from '../../domain/subscription/subscription.js';
import { Result } from '../../../../shared-kernel/domain/result.js';
export class SubscribeCommand {
  constructor({ subscriptionRepository, clock, idGenerator }) {
    this._repo = subscriptionRepository;
    this._clock = clock;
    this._ids = idGenerator;
  }

  async execute(input) {
    try {
      const sub = Subscription.create({
        id: this._ids?.next?.(),
        subscriberKind: input.subscriberKind,
        subscriberRef: input.subscriberRef,
        channel: input.channel,
        address: input.address,
        filter: input.filter ?? {},
        now: this._clock?.now?.()
      });
      await this._repo.save(sub);
      return Result.ok(sub);
    } catch (err) {
      return Result.fail(err);
    }
  }
}
