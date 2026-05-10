/**
 * RetryDeadLetterCommand — re-feeds a stored dead-letter envelope into the
 * delivery pipeline. On success, removes it from the DLQ.
 */

import { Result } from '../../../../shared/kernel/result.js';
import { DeadLetterNotFound } from '../../domain/errors.js';

export class RetryDeadLetterCommand {
  constructor({ deadLetterRepository, deliverEventCommand }) {
    this._dlq = deadLetterRepository;
    this._deliver = deliverEventCommand;
  }

  async execute({ id }) {
    const dl = await this._dlq.findById(id);
    if (!dl) {
      return Result.fail(new DeadLetterNotFound(id));
    }

    // Re-build a synthetic event from the stored envelope so the routing-policy
    // can re-evaluate matches.
    const event = {
      eventId: dl.eventId,
      type: dl.envelope.type,
      version: dl.envelope.version,
      payload: dl.envelope.payload,
      occurredAt: dl.envelope.occurredAt
    };

    const out = await this._deliver.execute(event);
    if (out.isOk) {
      await this._dlq.delete(id);
    }
    return out;
  }
}
