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

describe('notification HTTP router — owner-scoped subscription listing', () => {
  // Wraps the real query to record every execute() argument: the regression
  // this pins is the router issuing an UNFILTERED query (no kind+ref) and
  // filtering in JS, which materialised every active subscription per call.
  const buildSpiedApp = (userId) => {
    const subs = new InMemorySubscriptionRepository();
    const dlq = new InMemoryDeadLetterRepository();
    const inner = new ListSubscriptionsQuery({ subscriptionRepository: subs });
    const calls = [];
    const app = express();
    app.use((req, _res, next) => { req.user = userId == null ? {} : { id: userId }; next(); });
    app.use('/api/v1', createNotificationRouter({
      listSubscriptionsQuery: { execute: async (q) => { calls.push(q); return inner.execute(q); } },
      unsubscribeCommand: new UnsubscribeCommand({ subscriptionRepository: subs }),
      registerWebhookCommand: new RegisterWebhookCommand({ subscriptionRepository: subs }),
      listDeadLettersQuery: new ListDeadLettersQuery({ deadLetterRepository: dlq }),
      retryDeadLetterCommand: new RetryDeadLetterCommand({ deadLetterRepository: dlq, deliverEventCommand: {} }),
    }));
    return { app, subs, calls };
  };
  const idOf = (sub) => String(sub?.id?.value ?? sub?.id);
  const subscribeUser = (repo, ref, addr) => new SubscribeCommand({ subscriptionRepository: repo }).execute({
    subscriberKind: 'user', subscriberRef: ref, channel: 'websocket', address: addr,
  });
  const everyCallFiltered = (calls) => calls.every((q) => q && q.subscriberKind && q.subscriberRef);

  it('non-admin listing merges both kinds, hides other subjects and inactive rows, and never queries unfiltered', async () => {
    const { app, subs, calls } = buildSpiedApp('user-1');
    await subscribeUser(subs, 'user-1', 'conn-1');                       // own, user-kind
    await new RegisterWebhookCommand({ subscriptionRepository: subs })   // own, webhook-kind
      .execute({ subscriberRef: 'user-1', url: 'https://hooks.example.com/own' });
    await subscribeUser(subs, 'user-2', 'conn-2');                       // someone else's
    await new RegisterWebhookCommand({ subscriptionRepository: subs })
      .execute({ subscriberRef: 'user-2', url: 'https://hooks.example.com/other' });
    const deactivated = (await subscribeUser(subs, 'user-1', 'conn-9')).value;
    await subs.save(deactivated.deactivate());                           // own but inactive

    const res = await request(app).get('/api/v1/subscriptions');
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2); // conn-1 + own webhook, nothing of user-2, no inactive row
    expect(res.body.items.map((i) => i.subscriberRef).every((r) => r === 'user-1')).toBe(true);
    expect(everyCallFiltered(calls)).toBe(true);
  });

  it('?kind= stays scoped to the caller and filtered', async () => {
    const { app, subs, calls } = buildSpiedApp('user-1');
    await new RegisterWebhookCommand({ subscriptionRepository: subs })
      .execute({ subscriberRef: 'user-1', url: 'https://hooks.example.com/own' });
    await subscribeUser(subs, 'user-1', 'conn-1');
    const res = await request(app).get('/api/v1/subscriptions?kind=webhook');
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].channel).toBe('webhook');
    expect(calls).toEqual([{ subscriberKind: 'webhook', subscriberRef: 'user-1' }]);
  });

  it('a caller with no subject id gets an empty list and issues no query at all', async () => {
    const { app, calls } = buildSpiedApp(null);
    const res = await request(app).get('/api/v1/subscriptions');
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it('DELETE ownership check stays scoped: another subject’s row is 404, never listed', async () => {
    const { app, subs, calls } = buildSpiedApp('user-1');
    const created = await subscribeUser(subs, 'user-2', 'conn-2');
    const otherId = idOf(created.value);
    const res = await request(app).delete(`/api/v1/subscriptions/${otherId}`);
    expect(res.status).toBe(404);
    expect(everyCallFiltered(calls)).toBe(true);
    expect((await subs.findBySubscriber('user', 'user-2'))).toHaveLength(1); // untouched
  });
});
