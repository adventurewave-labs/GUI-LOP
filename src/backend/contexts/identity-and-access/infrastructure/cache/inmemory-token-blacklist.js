/**
 * In-memory TokenBlacklist for tests.
 * Stores `jti -> expiresAt(ms)` and lazily evicts expired entries.
 */
export class InMemoryTokenBlacklist {
  constructor({ now = () => Date.now() } = {}) {
    /** @private */
    this._entries = new Map();
    this._now = now;
  }

  async isBlacklisted(jti) {
    const exp = this._entries.get(jti);
    if (!exp) return false;
    if (exp <= this._now()) {
      this._entries.delete(jti);
      return false;
    }
    return true;
  }

  async blacklist(jti, ttlSeconds) {
    this._entries.set(jti, this._now() + ttlSeconds * 1000);
  }

  // Test helper
  size() {
    return this._entries.size;
  }
}
