import { RefreshConflictError } from '../../domain/errors.js';

/**
 * In-memory SessionRepository for tests.
 */
export class InMemorySessionRepository {
  constructor() {
    /** @private */
    this._byId = new Map();
    /** @private stored (current) hash per session, for compare-and-set */
    this._storedHash = new Map();
    /** @private superseded hash → sessionId */
    this._superseded = new Map();
  }

  async findById(id) {
    return this._byId.get(id) ?? null;
  }

  async findByRefreshTokenHash(hash) {
    for (const s of this._byId.values()) {
      // Compares stored digests, not the raw token; dev-only in-memory adapter.
      // eslint-disable-next-line security/detect-possible-timing-attacks
      if (s.refreshTokenHash === hash) return s;
    }
    return null;
  }

  async findByUserId(userId) {
    return [...this._byId.values()].filter((s) => s.userId === userId);
  }

  /** Same contract as the Pg adapter: rotation is compare-and-set. */
  async save(session) {
    const superseded = session.takeSupersededHashes?.() ?? [];
    const stored = this._storedHash.get(session.id);
    if (superseded.length > 0 && stored !== undefined && stored !== session.loadedRefreshTokenHash) {
      throw new RefreshConflictError();
    }
    for (const h of superseded) if (!this._superseded.has(h)) this._superseded.set(h, session.id);
    this._byId.set(session.id, session);
    this._storedHash.set(session.id, session.refreshTokenHash);
    session.loadedRefreshTokenHash = session.refreshTokenHash;
  }

  async findBySupersededRefreshTokenHash(hash) {
    const id = this._superseded.get(hash);
    return id ? this._byId.get(id) ?? null : null;
  }

  async revoke(sessionId, now) {
    const s = this._byId.get(sessionId);
    if (!s) return;
    s.revoke(now ?? new Date());
  }
}
