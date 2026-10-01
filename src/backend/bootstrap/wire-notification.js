// @ts-check
/**
 * wire-notification.js — composition for the Notification context.
 */
import { InMemorySubscriptionRepository } from '../contexts/notification/infrastructure/persistence/inmemory-subscription-repository.js';
import { InMemoryDeliveryAttemptRepository } from '../contexts/notification/infrastructure/persistence/inmemory-delivery-attempt-repository.js';
import { InMemoryDeadLetterRepository } from '../contexts/notification/infrastructure/persistence/inmemory-dead-letter-repository.js';
import { PgSubscriptionRepository } from '../contexts/notification/infrastructure/persistence/pg-subscription-repository.js';
import { PgDeliveryAttemptRepository } from '../contexts/notification/infrastructure/persistence/pg-delivery-attempt-repository.js';
import { PgDeadLetterRepository } from '../contexts/notification/infrastructure/persistence/pg-dead-letter-repository.js';

import { WsBroadcaster } from '../contexts/notification/infrastructure/transport/ws-broadcaster.js';
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
  config,
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

  const eventPublisher = redis
    ? new RedisEventPublisher({ pubClient: redis, subClient: redis.duplicate?.() ?? redis })
    : new InMemoryEventPublisher();
  // Real `ws` sockets. (Previously the in-memory test double was wired here;
  // it invokes `handler(envelope)` on the registered object, which threw for
  // every real WebSocket — so pushes to browsers never arrived.)
  const websocketBroadcaster = new WsBroadcaster({ eventPublisher });
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
    // Plain http and private targets are only acceptable outside production.
    allowInsecureWebhooks: config?.NODE_ENV !== 'production',
  });

  let consumerStop = null;
  /** @param {{ intervalMs?: number, batchSize?: number }} [opts] */
  function startOutboxConsumer({ intervalMs = 250, batchSize } = {}) {
    if (!outbox) return null;
    const consumer = new OutboxConsumer({
      outboxPort: outbox,
      deliverEventCommand,
      // Tuned default — see config-loader.js OUTBOX_BATCH_SIZE JSDoc.
      batchSize: batchSize ?? config?.OUTBOX_BATCH_SIZE ?? 200,
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

  /**
   * @param {import('node:http').Server} httpServer
   * @param {{ principalFromUpgrade?: Function, [k: string]: any }} [opts]
   */
  async function attachWebSocket(httpServer, { principalFromUpgrade } = {}) {
    if (!httpServer) return null;
    if (typeof principalFromUpgrade !== 'function') {
      // Fail closed: an unauthenticated WebSocket would let any client
      // subscribe to any user's event stream.
      throw new TypeError('attachWebSocket: principalFromUpgrade is required');
    }
    return attachWsServer(httpServer, {
      principalFromUpgrade,
      subscriptionRepository,
      websocketBroadcaster,
      allowedOrigins: config?.CORS_ORIGINS ?? null,
      maxConnectionsPerUser: config?.WS_MAX_CONNECTIONS_PER_USER ?? 10,
      maxPayloadBytes: config?.WS_MAX_PAYLOAD_BYTES ?? 64 * 1024,
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
