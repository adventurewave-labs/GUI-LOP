import { WorkflowConflictError } from '../../domain/errors.js';
import { Workflow } from '../../domain/workflow/workflow.js';

export class InMemoryWorkflowRepository {
  constructor() {
    /** @type {Map<string, object>} */
    this._byId = new Map();
    this.publishedEvents = [];
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
