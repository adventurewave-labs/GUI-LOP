/**
 * eventbus-throughput.bench.js — measures the outbox + websocket fanout costs.
 *
 *   - outbox.publish[N]        enqueue N events, then time the consumer to
 *                               fully drain the backlog (one tick per batch
 *                               of 100 records).
 *   - websocket.broadcast[N]   fan a single envelope to N in-memory
 *                               subscribers via the InMemoryWebSocketBroadcaster
 *                               and measure end-to-end fanout time.
 *
 * Each measurement is repeated `iterations` times so the harness can extract
 * percentiles. The measured loop discards setup time (e.g. enqueueing rows)
 * by calling the work-of-interest inside `fn` and re-priming inside `setup`.
 */

import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

import { InMemoryOutbox } from '../../../src/backend/shared-kernel/infrastructure/inmemory-outbox.js';
import { OutboxConsumer } from '../../../src/backend/contexts/notification/application/services/outbox-consumer.js';
import { InMemoryWebSocketBroadcaster } from '../../../src/backend/contexts/notification/infrastructure/transport/inmemory-ws-broadcaster.js';
import { Result } from '../../../src/backend/shared-kernel/domain/result.js';

import { runStandalone } from '../runner.js';

/* ---------------- helpers ---------------- */

function makeEvent(i) {
  return {
    toJSON() {
      return {
        eventId: randomUUID(),
        eventType: 'bench.event',
        eventVersion: 1,
        aggregateId: randomUUID(),
        aggregateType: 'BenchAggregate',
        payload: { i, value: 'hello world' },
        occurredAt: new Date().toISOString(),
      };
    },
  };
}

/**
 * Stub deliver-event command: succeed quickly so the outbox consumer can
 * mark records dispatched without exercising the full subscription router.
 * The fanout is measured separately in the websocket bench.
 */
const fastDeliver = {
  async execute(_event) {
    return Result.ok({ delivered: 1 });
  },
};

/**
 * Pre-fill an outbox with N pending events.
 */
async function fillOutbox(n) {
  const outbox = new InMemoryOutbox();
  const events = [];
  for (let i = 0; i < n; i += 1) events.push(makeEvent(i));
  await outbox.enqueue(events);
  return outbox;
}

/**
 * Drain an outbox with a fresh OutboxConsumer using batches of 100 until
 * fetchPending returns no rows. Returns the wall-clock elapsed time.
 */
async function drainOutbox(outbox) {
  const consumer = new OutboxConsumer({
    outboxPort: outbox,
    deliverEventCommand: fastDeliver,
    batchSize: 100,
  });
  let processed = 0;
  // Run ticks until we drain.
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const n = await consumer.tick();
    processed += n;
    if (n === 0) break;
  }
  return processed;
}

/* ---------------- bench builder ---------------- */

export function buildEventbusBenches() {
  return [
    // Outbox publish benches
    ...[100, 500, 1000].map((n) => ({
      name: `outbox.publish[${n}]`,
      warmup: 5,
      iterations: 30,
      async setup() {
        return { n, outbox: await fillOutbox(n) };
      },
      async fn(state) {
        // Re-fill before measurement so each iteration has a fresh backlog.
        if ((await state.outbox.fetchPending({ batchSize: 1 })).length === 0) {
          state.outbox = await fillOutbox(state.n);
        }
        await drainOutbox(state.outbox);
      },
    })),

    // WebSocket fanout benches
    ...[10, 100, 500].map((n) => ({
      name: `websocket.broadcast[${n}]`,
      warmup: 20,
      iterations: 200,
      async setup() {
        const broadcaster = new InMemoryWebSocketBroadcaster();
        for (let i = 0; i < n; i += 1) {
          // Each subscriber is registered with the same `subscriberRef`
          // so the broadcast filter matches all of them.
          broadcaster.register(
            `conn-${i}`,
            async (_envelope) => {
              // No-op: simulate a successful socket send. The InMemory
              // broadcaster awaits the handler so this contributes to fanout.
            },
            { subscriberRef: 'bench' },
          );
        }
        return { broadcaster };
      },
      async fn(state) {
        const envelope = {
          eventId: randomUUID(),
          type: 'bench.broadcast',
          payload: { i: 1 },
          occurredAt: new Date().toISOString(),
        };
        await state.broadcaster.broadcast({ subscriberRef: 'bench' }, envelope);
      },
    })),
  ];
}

/* ---------------- standalone entry ---------------- */

async function main() {
  await runStandalone('eventbus-throughput', () => buildEventbusBenches());
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('eventbus-throughput bench failed:', err);
    process.exit(1);
  });
}
