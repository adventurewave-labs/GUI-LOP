/**
 * In-memory implementation of HumanResponseRepository, used by tests and
 * by the development bootstrap before the Postgres adapter is wired.
 *
 * The optional `eventSink` lets the bootstrap forward the response's
 * pending events into the shared outbox, mirroring what the Postgres
 * adapter does transactionally. The aggregate's `pendingEvents()`
 * returns a copy, so the in-process `eventPublisher` (which is what
 * RecordHumanResponse calls explicitly) is unaffected.
 */
import { HumanResponseRepository } from '../../application/ports/human-response-repository.js';

export class InMemoryHumanResponseRepository extends HumanResponseRepository {
  constructor({ eventSink } = {}) {
    super();
    /** @type {Map<string, import('../../domain/human-response/human-response.js').HumanResponse>} */
    this._byId = new Map();
    this._eventSink = eventSink ?? null;
  }

  /** Wire (or replace) the event sink. */
  setEventSink(sink) {
    this._eventSink = sink ?? null;
  }

  async findById(id) {
    return this._byId.get(id) ?? null;
  }

  async findFor(workflowId, stepId) {
    for (const response of this._byId.values()) {
      if (response.workflowId === workflowId && response.stepId === stepId) {
        return response;
      }
    }
    return null;
  }

  async findByIdempotencyKey(workflowId, stepId, idempotencyKey) {
    for (const response of this._byId.values()) {
      if (
        response.workflowId === workflowId &&
        response.stepId === stepId &&
        response.idempotencyKey === idempotencyKey
      ) {
        return response;
      }
    }
    return null;
  }

  async save(response) {
    const isNew = !this._byId.has(response.id);
    this._byId.set(response.id, response);
    if (isNew && this._eventSink && typeof response.pendingEvents === 'function') {
      const events = response.pendingEvents();
      if (events.length) await this._eventSink.append(events);
    }
  }

  async clear() {
    this._byId.clear();
  }

  async all() {
    return Array.from(this._byId.values());
  }
}
