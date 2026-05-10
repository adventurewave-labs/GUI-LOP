/**
 * wire-notification.js — composition for the Notification context.
 */
import { InMemorySubscriptionRepository } from '../contexts/notification/infrastructure/persistence/inmemory-subscription-repository.js';
import { InMemoryDeliveryAttemptRepository } from '../contexts/notification/infrastructure/persistence/inmemory-delivery-attempt-repository.js';
import { InMemoryDeadLetterRepository } from '../contexts/notification/infrastructure/persistence/inmemory-dead-letter-repository.js';
import { PgSubscriptionRepository } from '../contexts/notification/infrastructure/persistence/pg-subscription-repository.js';
import { PgDeliveryAttemptRepository } from '../contexts/notification/infrastructure/persistence/pg-delivery-attempt-repository.js';
import { PgDeadLetterRepository } from '../contexts/notification/infrastructure/persistence/pg-dead-letter-repository.js';

import { InMemoryWebSocketBroadcaster } from '../contexts/notification/infrastructure/transport/inmemory-ws-broadcaster.js';
import { InMemoryEventPublisher } from '../contexts/notification/infrastructure/transport/inmemory-event-publisher.js';
import { RedisEventPublisher } from '../contexts/notification/infrastructure/transport/redis-event-publisher.js';
import { MockEmailSender } from '../contexts/notification/infrastructure/transport/mock-email-sender.js';
import { MockWebhookSender } from '../contexts/notification/infrastructure/transport/mock-webhook-sender.js';

import { SubscribeCommand } from '../contexts/notification/application/commands/subscribe.js';
import { UnsubscribeCommand } from '../contexts/notification/application/commands/unsubscribe.js';
import { RegisterWebhookCommand } from '../contexts/notification/application/commands/register-webhook.js';
import { DeliverEventCommand } from '../contexts/notification/application/commands/deliver-event.js';
import { RetryDeadLetterCommand } from '../contexts/notification/application/commands/retry-dead-letter.js';
import { ListSubscriptionsQuery } from '../contexts/notification/application/queries/list-subscriptions.js';
import { ListDeadLettersQuery } from '../contexts/notification/application/queries/list-dead-letters.js';
import { OutboxConsumer } from '../contexts/notification/application/services/outbox-consumer.js';

import { createNotificationRouter } from '../contexts/notification/interfaces/http/notification-router.js';
import { attach as attachWsServer } from '../contexts/notification/interfaces/websocket/ws-server.js';

export function wireNotification({
  pool,
  redis,
  outbox,
  clock,
  idGen,
  logger,
}) {
  const subscriptionRepository = pool
    ? new PgSubscriptionRepository(pool)
    : new InMemorySubscriptionRepository();
  const deliveryAttemptRepository = pool
    ? new PgDeliveryAttemptRepository(pool)
    : new InMemoryDeliveryAttemptRepository();
  const deadLetterRepository = pool
    ? new PgDeadLetterRepository(pool)
    : new InMemoryDeadLetterRepository();

  const websocketBroadcaster = new InMemoryWebSocketBroadcaster();
  const eventPublisher = redis
    ? new RedisEventPublisher({ pubClient: redis, subClient: redis.duplicate?.() ?? redis })
    : new InMemoryEventPublisher();
  const emailSender = new MockEmailSender();
  const webhookSender = new MockWebhookSender();

  const deliverEventCommand = new DeliverEventCommand({
    subscriptionRepository,
    deliveryAttemptRepository,
    deadLetterRepository,
    websocketBroadcaster,
    emailSender,
    webhookSender,
    eventPublisher,
    clock,
  });

  const useCases = {
    subscribe: new SubscribeCommand({ subscriptionRepository, idGenerator: idGen, clock }),
    unsubscribe: new UnsubscribeCommand({ subscriptionRepository }),
    registerWebhook: new RegisterWebhookCommand({
      subscriptionRepository,
      idGenerator: idGen,
      clock,
    }),
    deliverEvent: deliverEventCommand,
    retryDeadLetter: new RetryDeadLetterCommand({
      deadLetterRepository,
      deliverEventCommand,
    }),
    listSubscriptions: new ListSubscriptionsQuery({ subscriptionRepository }),
    listDeadLetters: new ListDeadLettersQuery({ deadLetterRepository }),
  };

  const router = createNotificationRouter({
    listSubscriptionsQuery: useCases.listSubscriptions,
    unsubscribeCommand: useCases.unsubscribe,
    registerWebhookCommand: useCases.registerWebhook,
    listDeadLettersQuery: useCases.listDeadLetters,
    retryDeadLetterCommand: useCases.retryDeadLetter,
  });

  let consumerStop = null;
  function startOutboxConsumer({ intervalMs = 250 } = {}) {
    if (!outbox) return null;
    const consumer = new OutboxConsumer({
      outboxPort: outbox,
      deliverEventCommand,
      logger,
    });
    consumerStop = consumer.start({ intervalMs });
    return consumer;
  }
  function stopOutboxConsumer() {
    if (consumerStop) {
      consumerStop();
      consumerStop = null;
    }
  }

  async function attachWebSocket(httpServer, { principalFromUpgrade } = {}) {
    if (!httpServer) return null;
    return attachWsServer(httpServer, {
      principalFromUpgrade:
        principalFromUpgrade ?? (async (req) => ({ id: req.headers?.['x-user-id'] ?? 'anonymous' })),
      subscriptionRepository,
      websocketBroadcaster,
    });
  }

  if (logger) {
    logger.info(
      `notification wired (${pool ? 'pg' : 'in-memory'} repos, ${
        redis ? 'redis' : 'in-memory'
      } event publisher)`,
    );
  }

  return {
    useCases,
    router,
    repositories: { subscriptionRepository, deliveryAttemptRepository, deadLetterRepository },
    transports: { websocketBroadcaster, eventPublisher, emailSender, webhookSender },
    startOutboxConsumer,
    stopOutboxConsumer,
    attachWebSocket,
  };
}
