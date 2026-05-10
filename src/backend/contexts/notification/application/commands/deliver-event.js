/**
 * DeliverEventCommand — main consumer entry.
 *
 * For a given event:
 *   1. Loads active subscriptions.
 *   2. Asks the routing-policy which subscriptions match.
 *   3. For each match, builds an envelope and dispatches via the channel sender.
 *   4. Records a DeliveryAttempt; on failure applies the retry-policy and
 *      either schedules a re-attempt (recorded) or stores a DeadLetter.
 */

import { randomUUID } from 'crypto';
import { Result } from '../../../../shared/kernel/result.js';
import { routesFor } from '../../domain/services/routing-policy.js';
import { build } from '../../domain/services/envelope-builder.js';
import { next as nextRetry, DeadLetter } from '../../domain/services/retry-policy.js';
import { CHANNELS } from '../../domain/subscription/channel.js';
import { NotificationDelivered, NotificationFailed } from '../../domain/events.js';

export class DeliverEventCommand {
  constructor({
    subscriptionRepository,
    deliveryAttemptRepository,
    deadLetterRepository,
    websocketBroadcaster,
    emailSender,
    webhookSender,
    eventPublisher,
    clock,
    retryOptions,
    domainEventSink
  }) {
    this._subs = subscriptionRepository;
    this._attempts = deliveryAttemptRepository;
    this._dlq = deadLetterRepository;
    this._ws = websocketBroadcaster;
    this._email = emailSender;
    this._webhook = webhookSender;
    this._publisher = eventPublisher;
    this._clock = clock;
    this._retryOpts = retryOptions ?? {};
    this._eventSink = domainEventSink ?? { append: async () => {} };
  }

  async execute(event) {
    const subs = await this._subs.findActive();
    const routes = routesFor(event, subs);

    const summary = {
      eventId: event.eventId ?? event.id ?? null,
      total: routes.size,
      delivered: 0,
      failed: 0,
      deadLettered: 0
    };

    for (const { subscription } of routes.routes) {
      const envelope = build(event, subscription);
      const attemptCount = await this._attempts.countForSubscription(
        subscription.id,
        summary.eventId
      );
      const attemptNumber = attemptCount + 1;

      try {
        await this._send(subscription, envelope);
        await this._attempts.record({
          id: randomUUID(),
          subscriptionId: subscription.id,
          eventId: summary.eventId,
          attemptNumber,
          status: 'delivered',
          error: null,
          attemptedAt: this._nowIso()
        });
        summary.delivered += 1;
        await this._eventSink.append(
          new NotificationDelivered({
            subscriptionId: subscription.id,
            eventId: summary.eventId,
            channel: subscription.channel.value,
            attemptNumber,
            occurredAt: this._nowIso()
          })
        );
      } catch (err) {
        summary.failed += 1;
        await this._attempts.record({
          id: randomUUID(),
          subscriptionId: subscription.id,
          eventId: summary.eventId,
          attemptNumber,
          status: 'failed',
          error: err?.message ?? String(err),
          attemptedAt: this._nowIso()
        });

        const decision = nextRetry(attemptNumber, this._retryOpts);
        const dead = decision === DeadLetter;
        if (dead) {
          summary.deadLettered += 1;
          await this._dlq.save({
            id: randomUUID(),
            subscriptionId: subscription.id,
            eventId: summary.eventId,
            envelope: envelope.toJSON(),
            attempts: attemptNumber,
            error: err?.message ?? String(err),
            createdAt: this._nowIso()
          });
        }
        await this._eventSink.append(
          new NotificationFailed({
            subscriptionId: subscription.id,
            eventId: summary.eventId,
            channel: subscription.channel.value,
            attemptNumber,
            error: err?.message ?? String(err),
            deadLettered: dead,
            occurredAt: this._nowIso()
          })
        );
      }
    }

    return Result.ok(summary);
  }

  async _send(subscription, envelope) {
    switch (subscription.channel.value) {
      case CHANNELS.WEBSOCKET:
        if (this._publisher) {
          // Cross-instance fan-out: publish, then locally also broadcast to
          // any matching local connection.
          await this._publisher.publish(`ws:${subscription.subscriberRef}`, envelope.toJSON());
        }
        await this._ws.broadcast(
          { subscriberRef: subscription.subscriberRef, channel: 'websocket' },
          envelope
        );
        return;
      case CHANNELS.EMAIL:
        await this._email.send(subscription.address.value, envelope);
        return;
      case CHANNELS.WEBHOOK:
        await this._webhook.send(subscription.address.value, envelope);
        return;
      default:
        throw new Error(`Unknown channel: ${subscription.channel.value}`);
    }
  }

  _nowIso() {
    if (this._clock?.nowIso) return this._clock.nowIso();
    if (this._clock?.now) return new Date(this._clock.now()).toISOString();
    return new Date().toISOString();
  }
}
