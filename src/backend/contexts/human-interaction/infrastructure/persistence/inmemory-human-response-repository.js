/**
 * In-memory implementation of HumanResponseRepository, used by tests and
 * by the development bootstrap before the Postgres adapter is wired.
 */
import { HumanResponseRepository } from '../../application/ports/human-response-repository.js';

export class InMemoryHumanResponseRepository extends HumanResponseRepository {
  constructor() {
    super();
    /** @type {Map<string, import('../../domain/human-response/human-response.js').HumanResponse>} */
    this._byId = new Map();
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
    this._byId.set(response.id, response);
  }

  async clear() {
    this._byId.clear();
  }

  async all() {
    return Array.from(this._byId.values());
  }
}
