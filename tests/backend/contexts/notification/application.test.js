/**
 * Notification context — application tests with in-memory adapters.
 */

import { SubscribeCommand } from '../../../../src/backend/contexts/notification/application/commands/subscribe.js';
import { UnsubscribeCommand } from '../../../../src/backend/contexts/notification/application/commands/unsubscribe.js';
import { RegisterWebhookCommand } from '../../../../src/backend/contexts/notification/application/commands/register-webhook.js';
import { DeliverEventCommand } from '../../../../src/backend/contexts/notification/application/commands/deliver-event.js';
import { RetryDeadLetterCommand } from '../../../../src/backend/contexts/notification/application/commands/retry-dead-letter.js';
import { OutboxConsumer } from '../../../../src/backend/contexts/notification/application/services/outbox-consumer.js';

import { InMemorySubscriptionRepository } from '../../../../src/backend/contexts/notification/infrastructure/persistence/inmemory-subscription-repository.js';
import { InMemoryDeliveryAttemptRepository } from '../../../../src/backend/contexts/notification/infrastructure/persistence/inmemory-delivery-attempt-repository.js';
import { InMemoryDeadLetterRepository } from '../../../../src/backend/contexts/notification/infrastructure/persistence/inmemory-dead-letter-repository.js';
import { InMemoryWebSocketBroadcaster } from '../../../../src/backend/contexts/notification/infrastructure/transport/inmemory-ws-broadcaster.js';
import { InMemoryEventPublisher } from '../../../../src/backend/contexts/notification/infrastructure/transport/inmemory-event-publisher.js';
import { MockEmailSender } from '../../../../src/backend/contexts/notification/infrastructure/transport/mock-email-sender.js';
import { MockWebhookSender } from '../../../../src/backend/contexts/notification/infrastructure/transport/mock-webhook-sender.js';

import { InMemoryOutbox } from '../../../../src/backend/shared/outbox/outbox-port.js';
import { FrozenClock, FixedIdGenerator } from '../../../../src/backend/shared/kernel/index.js';

function makeStack({ retryOptions } = {}) {
  const subs = new InMemorySubscriptionRepository();
  const attempts = new InMemoryDeliveryAttemptRepository();
  const dlq = new InMemoryDeadLetterRepository();
  const ws = new InMemoryWebSocketBroadcaster();
  const publisher = new InMemoryEventPublisher();
  const email = new MockEmailSender();
  const webhook = new MockWebhookSender({ failOn: (url) => url.includes('fail') });
  const clock = new FrozenClock(new Date('2026-05-10T00:00:00.000Z'));
  const ids = new FixedIdGenerator([
    'sub-aaaa', 'sub-bbbb', 'sub-cccc', 'sub-dddd'
  ]);

  const deliver = new DeliverEventCommand({
    subscriptionRepository: subs,
    deliveryAttemptRepository: attempts,
    deadLetterRepository: dlq,
    websocketBroadcaster: ws,
    emailSender: email,
    webhookSender: webhook,
    eventPublisher: publisher,
    clock,
    retryOptions
  });

  return { subs, attempts, dlq, ws, publisher, email, webhook, clock, ids, deliver };
}

describe('Subscribe / Unsubscribe', () => {
  it('persists a new active subscription', async () => {
    const { subs, ids, clock } = makeStack();
    const cmd = new SubscribeCommand({ subscriptionRepository: subs, idGenerator: ids, clock });
    const out = await cmd.execute({
      subscriberKind: 'user',
      subscriberRef: 'user-1',
      channel: 'websocket',
      address: 'conn-1'
    });
    expect(out.isOk).toBe(true);
    expect(subs.size()).toBe(1);
    expect(out.value.id).toBe('sub-aaaa');
  });

  it('rejects an invalid email address', async () => {
    const { subs } = makeStack();
    const cmd = new SubscribeCommand({ subscriptionRepository: subs });
    const out = await cmd.execute({
      subscriberKind: 'user',
      subscriberRef: 'u1',
      channel: 'email',
      address: 'not-an-email'
    });
    expect(out.isFail).toBe(true);
  });

  it('unsubscribe removes the subscription', async () => {
    const { subs, ids } = makeStack();
    const sub = await new SubscribeCommand({ subscriptionRepository: subs, idGenerator: ids }).execute({
      subscriberKind: 'user',
      subscriberRef: 'u',
      channel: 'webhook',
      address: 'https://x.test/h'
    });
    const out = await new UnsubscribeCommand({ subscriptionRepository: subs }).execute({ id: sub.value.id });
    expect(out.isOk).toBe(true);
    expect(subs.size()).toBe(0);
  });
});

describe('RegisterWebhook', () => {
  it('persists a webhook subscription', async () => {
    const { subs, ids } = makeStack();
    const cmd = new RegisterWebhookCommand({ subscriptionRepository: subs, idGenerator: ids });
    const out = await cmd.execute({
      subscriberRef: 'svc-1',
      url: 'https://hooks.example.com/incoming'
    });
    expect(out.isOk).toBe(true);
    expect(out.value.channel.value).toBe('webhook');
  });
});

describe('DeliverEvent', () => {
  it('routes a websocket event to the matching subscriber', async () => {
    const { subs, ws, deliver, ids } = makeStack();
    await new SubscribeCommand({ subscriptionRepository: subs, idGenerator: ids }).execute({
      subscriberKind: 'user',
      subscriberRef: 'user-1',
      channel: 'websocket',
      address: 'conn-1',
      filter: { eventTypes: ['workflow.started'] }
    });
    ws.register('conn-1', () => {}, { subscriberRef: 'user-1' });

    const out = await deliver.execute({
      eventId: 'evt-1',
      type: 'workflow.started',
      payload: { workflowId: 'wf-1' },
      occurredAt: '2026-05-10T00:00:00.000Z'
    });
    expect(out.isOk).toBe(true);
    expect(out.value.delivered).toBe(1);
    expect(out.value.failed).toBe(0);
    expect(ws.sent().length).toBe(1);
  });

  it('records a delivery attempt and dead-letters after maxAttempts', async () => {
    const { subs, dlq, attempts, deliver } = makeStack({ retryOptions: { maxAttempts: 1 } });
    await new SubscribeCommand({ subscriptionRepository: subs }).execute({
      subscriberKind: 'webhook',
      subscriberRef: 'svc-fail',
      channel: 'webhook',
      address: 'https://hooks.fail.example.com/bad'
    });

    const event = {
      eventId: 'evt-fail-1',
      type: 'workflow.failed',
      payload: { workflowId: 'wf-x' },
      occurredAt: '2026-05-10T00:00:00.000Z'
    };
    const out = await deliver.execute(event);
    expect(out.isOk).toBe(true);
    expect(out.value.failed).toBe(1);
    expect(out.value.deadLettered).toBe(1);
    expect(dlq.size()).toBe(1);
    expect(attempts.all()[0].status).toBe('failed');
  });

  it('does not deliver to deactivated subscriptions', async () => {
    const { subs, ws, deliver } = makeStack();
    const r = await new SubscribeCommand({ subscriptionRepository: subs }).execute({
      subscriberKind: 'user',
      subscriberRef: 'u-off',
      channel: 'websocket',
      address: 'conn-off'
    });
    await subs.save(r.value.deactivate());

    const out = await deliver.execute({
      eventId: 'evt-2',
      type: 'workflow.started',
      payload: {},
      occurredAt: '2026-05-10T00:00:00.000Z'
    });
    expect(out.value.total).toBe(0);
    expect(ws.sent().length).toBe(0);
  });
});

describe('RetryDeadLetter', () => {
  it('re-runs delivery and removes the DLQ entry on success', async () => {
    const stack = makeStack({ retryOptions: { maxAttempts: 1 } });
    await new SubscribeCommand({ subscriptionRepository: stack.subs }).execute({
      subscriberKind: 'webhook',
      subscriberRef: 'svc-retry',
      channel: 'webhook',
      address: 'https://hooks.fail.example.com/x'
    });

    await stack.deliver.execute({
      eventId: 'evt-r',
      type: 'workflow.started',
      payload: {},
      occurredAt: '2026-05-10T00:00:00.000Z'
    });
    expect(stack.dlq.size()).toBe(1);

    // Replace the failing subscription's address with a passing one so retry succeeds.
    const [sub] = await stack.subs.findActive();
    const goodAddr = await new SubscribeCommand({ subscriptionRepository: stack.subs }).execute({
      subscriberKind: 'webhook',
      subscriberRef: 'svc-retry',
      channel: 'webhook',
      address: 'https://hooks.good.example.com/x'
    });
    expect(goodAddr.isOk).toBe(true);
    await stack.subs.delete(sub.id);

    const dl = (await stack.dlq.list({}))[0];
    const retry = new RetryDeadLetterCommand({
      deadLetterRepository: stack.dlq,
      deliverEventCommand: stack.deliver
    });
    const out = await retry.execute({ id: dl.id });
    expect(out.isOk).toBe(true);
    expect(stack.dlq.size()).toBe(0);
  });
});

describe('OutboxConsumer', () => {
  it('drains the outbox and marks records dispatched', async () => {
    const { subs, ws, deliver } = makeStack();
    await new SubscribeCommand({ subscriptionRepository: subs }).execute({
      subscriberKind: 'user',
      subscriberRef: 'u-out',
      channel: 'websocket',
      address: 'conn-out',
      filter: { eventTypes: ['workflow.started'] }
    });
    ws.register('conn-out', () => {}, { subscriberRef: 'u-out' });

    const outbox = new InMemoryOutbox();
    await outbox.append({
      id: 'evt-outbox-1',
      type: 'workflow.started',
      version: 1,
      payload: { workflowId: 'wf-o' },
      occurredAt: '2026-05-10T00:00:00.000Z'
    });
    await outbox.append({
      id: 'evt-outbox-2',
      type: 'workflow.started',
      version: 1,
      payload: {},
      occurredAt: '2026-05-10T00:00:01.000Z'
    });

    const consumer = new OutboxConsumer({ outboxPort: outbox, deliverEventCommand: deliver });
    const processed = await consumer.tick();
    expect(processed).toBe(2);
    const records = outbox.all();
    expect(records.every((r) => r.status === 'dispatched')).toBe(true);
  });
});
