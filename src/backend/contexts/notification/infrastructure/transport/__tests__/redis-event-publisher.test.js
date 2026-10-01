/**
 * RedisEventPublisher — offline unit tests with a fake ioredis pair.
 *
 * Regression: with injected clients (the production wiring in
 * wire-notification.js) the `message` listener was never attached, so
 * cross-instance fan-out delivered nothing. The contract suite proves this
 * against real Redis; this test pins it in the default gate.
 */
import { EventEmitter } from 'node:events';
import { RedisEventPublisher } from '../redis-event-publisher.js';

function fakeRedisPair() {
  const sub = new EventEmitter();
  const subscribed = new Set();
  sub.subscribe = async (ch) => { subscribed.add(ch); };
  sub.unsubscribe = async (ch) => { subscribed.delete(ch); };
  const pub = {
    publish: async (ch, msg) => {
      if (subscribed.has(ch)) setImmediate(() => sub.emit('message', ch, msg));
      return 1;
    },
  };
  return { pub, sub, subscribed };
}

const tick = () => new Promise((r) => setImmediate(() => setImmediate(r)));

describe('RedisEventPublisher with injected clients', () => {
  test('delivers published envelopes to subscribers', async () => {
    const { pub, sub } = fakeRedisPair();
    const p = new RedisEventPublisher({ pubClient: pub, subClient: sub });
    const got = [];
    await p.subscribe('events', (env) => got.push(env));
    await p.publish('events', { type: 'A', n: 1 });
    await tick();
    expect(got).toEqual([{ type: 'A', n: 1 }]);
  });

  test('attaches exactly one listener however many channels/handlers', async () => {
    const { pub, sub } = fakeRedisPair();
    const p = new RedisEventPublisher({ pubClient: pub, subClient: sub });
    await p.subscribe('a', () => {});
    await p.subscribe('a', () => {});
    await p.subscribe('b', () => {});
    expect(sub.listenerCount('message')).toBe(1);
  });

  test('a throwing handler does not starve the others; unsubscribe is per-handler', async () => {
    const { pub, sub, subscribed } = fakeRedisPair();
    const p = new RedisEventPublisher({ pubClient: pub, subClient: sub });
    const b = [];
    const unsubA = await p.subscribe('ch', () => { throw new Error('boom'); });
    await p.subscribe('ch', (env) => b.push(env));
    await p.publish('ch', { n: 1 });
    await tick();
    expect(b).toHaveLength(1);
    await unsubA();
    expect(subscribed.has('ch')).toBe(true); // b still listening
  });

  test('close() detaches the listener', async () => {
    const { pub, sub } = fakeRedisPair();
    const p = new RedisEventPublisher({ pubClient: pub, subClient: sub });
    await p.subscribe('x', () => {});
    await p.close();
    expect(sub.listenerCount('message')).toBe(0);
  });
});
