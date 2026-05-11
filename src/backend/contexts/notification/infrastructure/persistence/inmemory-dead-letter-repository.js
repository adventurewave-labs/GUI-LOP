import { DeadLetterRepository } from '../../application/ports/dead-letter-repository.js';

export class InMemoryDeadLetterRepository extends DeadLetterRepository {
  constructor() {
    super();
    this._byId = new Map();
  }

  async save(record) {
    this._byId.set(record.id, { ...record });
  }

  async findById(id) {
    const r = this._byId.get(id);
    return r ? { ...r } : null;
  }

  async list({ limit = 100, offset = 0 } = {}) {
    const all = [...this._byId.values()].sort((a, b) =>
      a.createdAt < b.createdAt ? 1 : -1
    );
    return all.slice(offset, offset + limit);
  }

  async delete(id) {
    this._byId.delete(id);
  }

  size() {
    return this._byId.size;
  }
}
