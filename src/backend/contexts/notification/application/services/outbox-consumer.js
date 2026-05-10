/**
 * OutboxConsumer — long-running poller that drains the outbox and feeds the
 * DeliverEvent command. Designed for deterministic testing: pass a frozen
 * clock and an in-memory outbox and call `tick()` directly.
 */

export class OutboxConsumer {
  constructor({ outboxPort, deliverEventCommand, batchSize = 25, logger }) {
    this._outbox = outboxPort;
    this._deliver = deliverEventCommand;
    this._batchSize = batchSize;
    this._logger = logger ?? { info: () => {}, warn: () => {}, error: () => {} };
    this._timer = null;
    this._running = false;
  }

  /** Process exactly one batch. Returns the number of records processed. */
  async tick() {
    const batch = await this._outbox.fetchPending({ batchSize: this._batchSize });
    let processed = 0;
    for (const record of batch) {
      const event = {
        eventId: record.id,
        type: record.type,
        version: record.version ?? 1,
        aggregateId: record.aggregateId,
        aggregateType: record.aggregateType,
        payload: record.payload ?? {},
        occurredAt: record.occurredAt
      };
      try {
        const result = await this._deliver.execute(event);
        if (result.isOk) {
          await this._outbox.markDispatched(record.id);
        } else {
          await this._outbox.markFailed(record.id, result.error?.message ?? 'unknown');
        }
      } catch (err) {
        this._logger.error('OutboxConsumer tick error', err);
        await this._outbox.markFailed(record.id, err?.message ?? String(err));
      }
      processed += 1;
    }
    return processed;
  }

  /** Start the polling loop. Returns a stop function. */
  start({ intervalMs = 250 } = {}) {
    if (this._running) return this.stop.bind(this);
    this._running = true;
    const loop = async () => {
      if (!this._running) return;
      try {
        await this.tick();
      } catch (err) {
        this._logger.error('OutboxConsumer loop error', err);
      } finally {
        if (this._running) {
          this._timer = setTimeout(loop, intervalMs);
          if (typeof this._timer.unref === 'function') this._timer.unref();
        }
      }
    };
    this._timer = setTimeout(loop, intervalMs);
    if (typeof this._timer.unref === 'function') this._timer.unref();
    return this.stop.bind(this);
  }

  stop() {
    this._running = false;
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }
}

/** Convenience factory matching the spec's `start({outboxPort, intervalMs})` shape. */
export function start({ outboxPort, deliverEventCommand, intervalMs = 250, batchSize = 25, logger } = {}) {
  const consumer = new OutboxConsumer({ outboxPort, deliverEventCommand, batchSize, logger });
  const stop = consumer.start({ intervalMs });
  return { consumer, stop };
}
