/**
 * In-memory grants repository for direct (non-role) permissions.
 * Stored as `Permission[]` per userId.
 */
export class InMemoryGrantsRepository {
  constructor() {
    /** @private */
    this._byUser = new Map();
  }

  async list(userId) {
    return [...(this._byUser.get(userId) ?? [])];
  }

  async add(userId, permission) {
    const set = this._byUser.get(userId) ?? [];
    if (!set.some((p) => p.equals(permission))) set.push(permission);
    this._byUser.set(userId, set);
  }

  async remove(userId, permission) {
    const set = this._byUser.get(userId) ?? [];
    this._byUser.set(
      userId,
      set.filter((p) => !p.equals(permission)),
    );
  }
}
