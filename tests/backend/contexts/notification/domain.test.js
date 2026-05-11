/**
 * Notification context — domain unit tests for VOs and pure services.
 */

import { Channel, CHANNELS } from '../../../../src/backend/contexts/notification/domain/subscription/channel.js';
import { Filter } from '../../../../src/backend/contexts/notification/domain/subscription/filter.js';
import { EndpointAddress } from '../../../../src/backend/contexts/notification/domain/subscription/endpoint-address.js';
import { Envelope } from '../../../../src/backend/contexts/notification/domain/subscription/envelope.js';
import { Subscription } from '../../../../src/backend/contexts/notification/domain/subscription/subscription.js';
import { routesFor } from '../../../../src/backend/contexts/notification/domain/services/routing-policy.js';
import { build } from '../../../../src/backend/contexts/notification/domain/services/envelope-builder.js';
import { next as retryNext, DeadLetter } from '../../../../src/backend/contexts/notification/domain/services/retry-policy.js';

describe('Channel VO', () => {
  it('accepts known channel values', () => {
    expect(Channel.of('websocket').value).toBe('websocket');
    expect(Channel.of('email').value).toBe('email');
    expect(Channel.of('webhook').value).toBe('webhook');
  });

  it('rejects unknown channel values', () => {
    expect(() => Channel.of('sms')).toThrow(/Unknown channel/);
  });
});

describe('Filter VO', () => {
  it('matches when filter is empty', () => {
    const f = Filter.of({});
    expect(f.matches({ type: 'workflow.started', payload: {} })).toBe(true);
  });

  it('filters by event type', () => {
    const f = Filter.of({ eventTypes: ['workflow.started'] });
    expect(f.matches({ type: 'workflow.started' })).toBe(true);
    expect(f.matches({ type: 'workflow.completed' })).toBe(false);
  });

  it('filters by workflow id (payload or aggregate)', () => {
    const f = Filter.of({ workflowIds: ['wf-1'] });
    expect(f.matches({ type: 't', payload: { workflowId: 'wf-1' } })).toBe(true);
    expect(f.matches({ type: 't', aggregateType: 'Workflow', aggregateId: 'wf-1' })).toBe(true);
    expect(f.matches({ type: 't', payload: { workflowId: 'wf-2' } })).toBe(false);
  });
});

describe('EndpointAddress VO', () => {
  it('validates emails', () => {
    expect(() => EndpointAddress.of({ channel: 'email', value: 'a@b.com' })).not.toThrow();
    expect(() => EndpointAddress.of({ channel: 'email', value: 'oops' })).toThrow();
  });

  it('validates webhook URLs', () => {
    expect(() => EndpointAddress.of({ channel: 'webhook', value: 'https://x.test/hook' })).not.toThrow();
    expect(() => EndpointAddress.of({ channel: 'webhook', value: 'not-a-url' })).toThrow();
    expect(() => EndpointAddress.of({ channel: 'webhook', value: 'ftp://x' })).toThrow();
  });

  it('accepts arbitrary websocket addresses', () => {
    expect(() => EndpointAddress.of({ channel: 'websocket', value: 'conn-123' })).not.toThrow();
  });
});

describe('Envelope VO', () => {
  it('requires type and occurredAt', () => {
    expect(() => Envelope.of({ occurredAt: 'now' })).toThrow();
    expect(() => Envelope.of({ type: 't' })).toThrow();
  });
});

describe('Subscription aggregate', () => {
  const baseSpec = () => ({
    subscriberKind: 'user',
    subscriberRef: 'user-1',
    channel: 'websocket',
    address: 'conn-1',
    filter: {}
  });

  it('creates an active subscription', () => {
    const s = Subscription.create(baseSpec());
    expect(s.isActive).toBe(true);
    expect(s.channel.value).toBe(CHANNELS.WEBSOCKET);
  });

  it('refuses mismatched channel/address', () => {
    expect(() =>
      new Subscription({
        id: 'x',
        subscriberKind: 'user',
        subscriberRef: 'u',
        channel: Channel.of('email'),
        address: EndpointAddress.of({ channel: 'webhook', value: 'https://x.test/h' }),
        filter: Filter.of({})
      })
    ).toThrow(/does not match/);
  });

  it('records seen on active sub and rejects on deactivated', () => {
    const s = Subscription.create(baseSpec());
    const seen = s.recordSeen('2026-05-10T00:00:00.000Z');
    expect(seen.lastActiveAt).toBe('2026-05-10T00:00:00.000Z');
    const off = s.deactivate();
    expect(off.isActive).toBe(false);
    expect(() => off.recordSeen('2026-05-10T00:00:00.000Z')).toThrow();
  });

  it('activate/deactivate are idempotent', () => {
    const s = Subscription.create(baseSpec());
    expect(s.activate()).toBe(s);
    const off = s.deactivate();
    expect(off.deactivate()).toBe(off);
  });
});

describe('routing-policy', () => {
  it('returns matched active subscriptions only', () => {
    const a = Subscription.create({
      subscriberKind: 'user',
      subscriberRef: 'u1',
      channel: 'websocket',
      address: 'c1',
      filter: { eventTypes: ['workflow.started'] }
    });
    const b = Subscription.create({
      subscriberKind: 'user',
      subscriberRef: 'u2',
      channel: 'websocket',
      address: 'c2',
      filter: { eventTypes: ['workflow.completed'] }
    });
    const c = a.deactivate();

    const event = { type: 'workflow.started', payload: {} };
    const routes = routesFor(event, [a, b, c]);
    expect(routes.size).toBe(1);
    expect(routes.routes[0].subscription).toBe(a);
  });
});

describe('retry-policy', () => {
  it('produces increasing delays with exponential backoff', () => {
    const d0 = retryNext(0, { baseMs: 1000, factor: 2, maxAttempts: 5 });
    const d1 = retryNext(1, { baseMs: 1000, factor: 2, maxAttempts: 5 });
    const d2 = retryNext(2, { baseMs: 1000, factor: 2, maxAttempts: 5 });
    expect(d0.delayMs).toBe(1000);
    expect(d1.delayMs).toBe(2000);
    expect(d2.delayMs).toBe(4000);
  });

  it('clamps to maxMs', () => {
    const d = retryNext(20, { baseMs: 1000, factor: 2, maxMs: 30000, maxAttempts: 100 });
    expect(d.delayMs).toBe(30000);
  });

  it('returns DeadLetter after maxAttempts', () => {
    expect(retryNext(5, { maxAttempts: 5 })).toBe(DeadLetter);
    expect(retryNext(6, { maxAttempts: 5 })).toBe(DeadLetter);
  });
});

describe('envelope-builder', () => {
  it('wraps an event into an Envelope VO', () => {
    const env = build(
      {
        type: 'workflow.started',
        version: 1,
        payload: { workflowId: 'w1' },
        occurredAt: '2026-05-10T00:00:00.000Z'
      },
      null
    );
    expect(env).toBeInstanceOf(Envelope);
    expect(env.type).toBe('workflow.started');
    expect(env.payload.workflowId).toBe('w1');
  });
});
