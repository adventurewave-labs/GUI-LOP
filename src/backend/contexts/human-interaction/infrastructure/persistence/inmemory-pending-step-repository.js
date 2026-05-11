/**
 * In-memory implementation of PendingStepRepository.
 *
 * Stored under composite key `${workflowId}:${stepId}`.
 */
import { PendingStepRepository } from '../../application/ports/pending-step-repository.js';

const k = (workflowId, stepId) => `${workflowId}:${stepId}`;

export class InMemoryPendingStepRepository extends PendingStepRepository {
  constructor() {
    super();
    /** @type {Map<string, import('../../domain/pending-step/pending-step.js').PendingStep>} */
    this._steps = new Map();
  }

  async findOverdue(now, limit = 50) {
    const out = [];
    for (const step of this._steps.values()) {
      if (step.isOverdue(now)) out.push(step);
      if (out.length >= limit) break;
    }
    out.sort((a, b) => (a.deadline?.getTime() ?? 0) - (b.deadline?.getTime() ?? 0));
    return out;
  }

  async findByKey(workflowId, stepId) {
    return this._steps.get(k(workflowId, stepId)) ?? null;
  }

  async upsert(step) {
    this._steps.set(k(step.workflowId, step.stepId), step);
  }

  async remove(workflowId, stepId) {
    this._steps.delete(k(workflowId, stepId));
  }

  async list(filter = {}) {
    let out = Array.from(this._steps.values());
    if (filter.workflowId) out = out.filter((s) => s.workflowId === filter.workflowId);
    if (filter.openOnly) out = out.filter((s) => !s.isClosed());
    return out;
  }

  async clear() {
    this._steps.clear();
  }
}
