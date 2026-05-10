import { Session } from '../../domain/session/session.js';

/**
 * Postgres SessionRepository against the `user_sessions` table.
 * Note: the schema's `session_token` column stores the hashed
 * refresh-token (we never persist the raw secret).
 */
export class PgSessionRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async findById(id) {
    const { rows } = await this.pool.query(
      'SELECT id, user_id, session_token, ip_address, user_agent, created_at, expires_at, is_active, metadata FROM user_sessions WHERE id = $1',
      [id],
    );
    return rows[0] ? this._hydrate(rows[0]) : null;
  }

  async findByRefreshTokenHash(hash) {
    const { rows } = await this.pool.query(
      'SELECT id, user_id, session_token, ip_address, user_agent, created_at, expires_at, is_active, metadata FROM user_sessions WHERE session_token = $1',
      [hash],
    );
    return rows[0] ? this._hydrate(rows[0]) : null;
  }

  async findByUserId(userId) {
    const { rows } = await this.pool.query(
      'SELECT id, user_id, session_token, ip_address, user_agent, created_at, expires_at, is_active, metadata FROM user_sessions WHERE user_id = $1 ORDER BY created_at DESC',
      [userId],
    );
    return rows.map((r) => this._hydrate(r));
  }

  async save(session) {
    await this.pool.query(
      `INSERT INTO user_sessions (id, user_id, session_token, ip_address, user_agent, created_at, expires_at, is_active, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE SET
         session_token = EXCLUDED.session_token,
         expires_at = EXCLUDED.expires_at,
         is_active = EXCLUDED.is_active,
         metadata = EXCLUDED.metadata`,
      [
        session.id,
        session.userId,
        session.refreshTokenHash,
        session.ip,
        session.userAgent,
        session.createdAt,
        session.expiresAt,
        session.isActive,
        session.metadata,
      ],
    );
  }

  async revoke(sessionId) {
    await this.pool.query(
      'UPDATE user_sessions SET is_active = false WHERE id = $1',
      [sessionId],
    );
  }

  /** @private */
  _hydrate(row) {
    return new Session({
      id: row.id,
      userId: row.user_id,
      refreshTokenHash: row.session_token,
      ip: row.ip_address ?? null,
      userAgent: row.user_agent ?? null,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      lastSeenAt: row.created_at,
      isActive: row.is_active,
      metadata: row.metadata ?? {},
    });
  }
}
