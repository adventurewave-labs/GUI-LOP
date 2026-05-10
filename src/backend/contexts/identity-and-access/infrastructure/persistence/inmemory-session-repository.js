/**
 * In-memory SessionRepository for tests.
 */
export class InMemorySessionRepository {
  constructor() {
    /** @private */
    this._byId = new Map();
  }

  async findById(id) {
    return this._byId.get(id) ?? null;
  }

  async findByRefreshTokenHash(hash) {
    for (const s of this._byId.values()) {
      if (s.refreshTokenHash === hash) return s;
    }
    return null;
  }

  async findByUserId(userId) {
    return [...this._byId.values()].filter((s) => s.userId === userId);
  }

  async save(session) {
    this._byId.set(session.id, session);
  }

  async revoke(sessionId, now) {
    const s = this._byId.get(sessionId);
    if (!s) return;
    s.revoke(now ?? new Date());
  }
}
