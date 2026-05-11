/**
 * RebuildProjection — admin-only stub. Streams events from the event store and
 * passes each through a registered handler. Most projections in GUI-LOP are
 * derived directly via SQL views, so this is a thin orchestration shell.
 */
import { Result } from '../../../../shared-kernel/domain/result.js';
export class RebuildProjectionCommand {
  constructor({ eventStore, projectionUpdater }) {
    this._events = eventStore;
    this._handler = projectionUpdater;
  }

  async execute({ aggregateType, aggregateId, range } = {}) {
    const events = await this._events.query({ aggregateType, aggregateId, range });
    let processed = 0;
    for (const event of events) {
      await this._handler.handle(event);
      processed += 1;
    }
    return Result.ok({ processed });
  }
}
