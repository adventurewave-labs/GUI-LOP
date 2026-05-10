import { ConflictError } from '../../shared-kernel-stubs.js';

/**
 * In-memory UserRepository for tests.
 * Stores aggregates by id; secondary indexes for email/username.
 * Enforces optimistic concurrency.
 */
export class InMemoryUserRepository {
  constructor() {
    /** @private */
    this._byId = new Map();
  }

  async findById(id) {
    return this._byId.get(id) ?? null;
  }

  async findByEmail(email) {
    const target = email?.value ?? email;
    for (const u of this._byId.values()) {
      if (u.email.value === target) return u;
    }
    return null;
  }

  async findByUsername(username) {
    const target = username?.value ?? username;
    for (const u of this._byId.values()) {
      if (u.username.value === target) return u;
    }
    return null;
  }

  async save(user) {
    const existing = this._byId.get(user.id);
    if (existing && existing !== user && existing.version > user.version) {
      throw new ConflictError(
        `Optimistic concurrency conflict on user ${user.id}`,
      );
    }
    this._byId.set(user.id, user);
  }

  // Test helpers
  size() {
    return this._byId.size;
  }
}
