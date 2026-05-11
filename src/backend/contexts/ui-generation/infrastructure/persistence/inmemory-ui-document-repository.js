import { UIDocumentRepository } from '../../application/ports/ui-document-repository.js';

export class InMemoryUIDocumentRepository extends UIDocumentRepository {
  constructor() {
    super();
    this._byId = new Map();
  }

  async save(doc) {
    this._byId.set(doc.id, doc);
  }

  async findById(id) {
    return this._byId.get(id) ?? null;
  }

  async findByStep(workflowId, stepId) {
    return [...this._byId.values()].filter(
      (d) => d.workflowId === workflowId && d.stepId === stepId
    );
  }

  size() {
    return this._byId.size;
  }
}
