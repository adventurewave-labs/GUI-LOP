/**
 * Notification context — API smoke tests for the HTTP router.
 */

import express from 'express';
import request from 'supertest';

import { createNotificationRouter } from '../../../../src/backend/contexts/notification/interfaces/http/notification-router.js';
import { ListSubscriptionsQuery } from '../../../../src/backend/contexts/notification/application/queries/list-subscriptions.js';
import { ListDeadLettersQuery } from '../../../../src/backend/contexts/notification/application/queries/list-dead-letters.js';
import { UnsubscribeCommand } from '../../../../src/backend/contexts/notification/application/commands/unsubscribe.js';
import { RegisterWebhookCommand } from '../../../../src/backend/contexts/notification/application/commands/register-webhook.js';
import { RetryDeadLetterCommand } from '../../../../src/backend/contexts/notification/application/commands/retry-dead-letter.js';
import { DeliverEventCommand } from '../../../../src/backend/contexts/notification/application/commands/deliver-event.js';
import { SubscribeCommand } from '../../../../src/backend/contexts/notification/application/commands/subscribe.js';

import { InMemorySubscriptionRepository } from '../../../../src/backend/contexts/notification/infrastructure/persistence/inmemory-subscription-repository.js';
import { InMemoryDeliveryAttemptRepository } from '../../../../src/backend/contexts/notification/infrastructure/persistence/inmemory-delivery-attempt-repository.js';
import { InMemoryDeadLetterRepository } from '../../../../src/backend/contexts/notification/infrastructure/persistence/inmemory-dead-letter-repository.js';
import { InMemoryWebSocketBroadcaster } from '../../../../src/backend/contexts/notification/infrastructure/transport/inmemory-ws-broadcaster.js';
import { MockEmailSender } from '../../../../src/backend/contexts/notification/infrastructure/transport/mock-email-sender.js';
import { MockWebhookSender } from '../../../../src/backend/contexts/notification/infrastructure/transport/mock-webhook-sender.js';

function buildApp() {
  const subs = new InMemorySubscriptionRepository();
  const dlq = new InMemoryDeadLetterRepository();
  const attempts = new InMemoryDeliveryAttemptRepository();
  const ws = new InMemoryWebSocketBroadcaster();
  const email = new MockEmailSender();
  const webhook = new MockWebhookSender();
  const deliver = new DeliverEventCommand({
    subscriptionRepository: subs,
    deliveryAttemptRepository: attempts,
    deadLetterRepository: dlq,
    websocketBroadcaster: ws,
    emailSender: email,
    webhookSender: webhook
  });

  const app = express();
  app.use((req, _res, next) => { req.user = { id: 'user-1' }; next(); });
  app.use('/api/v1', createNotificationRouter({
    listSubscriptionsQuery: new ListSubscriptionsQuery({ subscriptionRepository: subs }),
    unsubscribeCommand: new UnsubscribeCommand({ subscriptionRepository: subs }),
    registerWebhookCommand: new RegisterWebhookCommand({ subscriptionRepository: subs }),
    listDeadLettersQuery: new ListDeadLettersQuery({ deadLetterRepository: dlq }),
    retryDeadLetterCommand: new RetryDeadLetterCommand({
      deadLetterRepository: dlq,
      deliverEventCommand: deliver
    })
  }));

  return { app, subs, dlq };
}

describe('notification HTTP router', () => {
  it('POST /webhooks creates a subscription', async () => {
    const { app, subs } = buildApp();
    const res = await request(app)
      .post('/api/v1/webhooks')
      .send({ url: 'https://hook.example.com/x' });
    expect(res.status).toBe(201);
    expect(res.body.channel).toBe('webhook');
    expect(subs.size()).toBe(1);
  });

  it('GET /subscriptions lists current subs', async () => {
    const { app, subs } = buildApp();
    await new SubscribeCommand({ subscriptionRepository: subs }).execute({
      subscriberKind: 'user',
      subscriberRef: 'user-1',
      channel: 'websocket',
      address: 'conn-1'
    });
    const res = await request(app).get('/api/v1/subscriptions');
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBe(1);
  });

  it('DELETE /subscriptions/:id returns 404 when missing', async () => {
    const { app } = buildApp();
    const res = await request(app).delete('/api/v1/subscriptions/non-existent');
    expect(res.status).toBe(404);
  });

  it('GET /dead-letters returns list', async () => {
    const { app, dlq } = buildApp();
    await dlq.save({
      id: 'dl-1',
      subscriptionId: null,
      eventId: 'evt-1',
      envelope: { type: 't', version: 1, payload: {}, occurredAt: '2026-01-01T00:00:00.000Z' },
      attempts: 5,
      error: 'boom',
      createdAt: '2026-05-10T00:00:00.000Z'
    });
    const res = await request(app).get('/api/v1/dead-letters');
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBe(1);
  });
});
