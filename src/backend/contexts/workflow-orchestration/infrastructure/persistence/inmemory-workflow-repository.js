import { WorkflowConflictError } from '../../domain/errors.js';
import { Workflow } from '../../domain/workflow/workflow.js';

/**
 * In-memory `WorkflowRepository` for tests and dev-mode bootstrap.
 *
 * In production, the Pg adapter enqueues events into the outbox inside
 * the same transaction as the aggregate write. The in-memory repo can't
 * do that, so when a `setEventSink(sink)` has been wired by the
 * composition root we forward `pullEvents()` to that sink after every
 * successful save. This keeps the OutboxConsumer / WebSocket fan-out
 * working end-to-end without Postgres.
 *
 * The sink is invoked synchronously inside `save()` but is a fire-and-
 * forget: we await the call but never re-emit its events back into the
 * sink, so there is no recursion risk.
 */
export class InMemoryWorkflowRepository {
  constructor({ eventSink } = {}) {
    /** @type {Map<string, object>} */
    this._byId = new Map();
    this.publishedEvents = [];
    /** @type {{append: (events: any[]) => Promise<void>}|null} */
    this._eventSink = eventSink ?? null;
  }

  /** Wire (or replace) the event sink. */
  setEventSink(sink) {
    this._eventSink = sink ?? null;
  }

  async findById(id) {
    const snap = this._byId.get(id);
    if (!snap) return null;
    return Workflow.rehydrate(deepClone(snap));
  }

  async save(workflow) {
    const existing = this._byId.get(workflow.id);
    const expectedVersion = workflow.version;
    if (existing && existing.version !== expectedVersion) {
      throw new WorkflowConflictError(workflow.id, expectedVersion, existing.version);
    }
    workflow._bumpVersion();
    const snap = workflow.toState();
    this._byId.set(workflow.id, snap);
    const events = workflow.pullEvents();
    this.publishedEvents.push(...events);
    if (this._eventSink && events.length) {
      await this._eventSink.append(events);
    }
  }

  async status(id) {
    const snap = this._byId.get(id);
    if (!snap) return null;
    return { status: snap.status, version: snap.version };
  }

  async list() {
    return [...this._byId.values()].map((snap) => Workflow.rehydrate(deepClone(snap)));
  }
}

function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }
