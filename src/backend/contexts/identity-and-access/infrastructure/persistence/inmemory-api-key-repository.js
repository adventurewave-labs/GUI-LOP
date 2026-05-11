/**
 * In-memory ApiKeyRepository for tests/dev.
 *
 * Indexes by id and by hash for O(1) lookup along the auth-middleware
 * hot path. `findActiveByUser` returns non-revoked keys; expired keys are
 * still listed (the listing endpoint marks them as inactive via the
 * aggregate's `isUsable(now)` check rather than filtering at the repo).
 */
export class InMemoryApiKeyRepository {
  constructor() {
    /** @private */
    this._byId = new Map();
    /** @private */
    this._byHash = new Map();
  }

  async findById(id) {
    return this._byId.get(id) ?? null;
  }

  async findByHash(hash) {
    return this._byHash.get(hash) ?? null;
  }

  async findActiveByUser(userId) {
    return [...this._byId.values()].filter(
      (k) => k.userId === userId && k.isActive,
    );
  }

  async save(apiKey) {
    const id = apiKey.id?.value ?? apiKey.id;
    this._byId.set(id, apiKey);
    if (apiKey.keyHash) {
      this._byHash.set(apiKey.keyHash, apiKey);
    }
  }

  size() {
    return this._byId.size;
  }
}
