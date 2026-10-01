import { Session } from '../../domain/session/session.js';
import { isUuid, idValue } from '../../../../shared-kernel/infrastructure/ids.js';
import { RefreshConflictError } from '../../domain/errors.js';

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
    if (!isUuid(id)) return null; // malformed id → not found, not a 22P02/500
    id = idValue(id); // accept id value objects as well as strings
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

  /**
   * Upsert the session. A refresh-token rotation is compare-and-set: the row
   * is only updated if its stored hash is still the one this aggregate was
   * loaded with, so two concurrent refreshes of the same token cannot both
   * win (the loser gets RefreshConflictError → 409). Rotated-away hashes go
   * to refresh_token_history in the same transaction (reuse detection).
   */
  async save(session) {
    const superseded = session.takeSupersededHashes?.() ?? [];
    const rotated = superseded.length > 0;
    const client = typeof this.pool.connect === 'function' ? await this.pool.connect() : null;
    const db = client ?? this.pool;
    try {
      if (client) await db.query('BEGIN');
      const res = await db.query(
        `INSERT INTO user_sessions (id, user_id, session_token, ip_address, user_agent, created_at, expires_at, is_active, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO UPDATE SET
           session_token = EXCLUDED.session_token,
           expires_at = EXCLUDED.expires_at,
           is_active = EXCLUDED.is_active,
           metadata = EXCLUDED.metadata
         WHERE $10::text IS NULL OR user_sessions.session_token = $10::text`,
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
          rotated ? session.loadedRefreshTokenHash : null,
        ],
      );
      if (res.rowCount === 0) throw new RefreshConflictError();
      for (const hash of superseded) {
        await db.query(
          `INSERT INTO refresh_token_history (token_hash, session_id) VALUES ($1, $2)
           ON CONFLICT (token_hash) DO NOTHING`,
          [hash, session.id],
        );
      }
      if (client) await db.query('COMMIT');
      session.loadedRefreshTokenHash = session.refreshTokenHash;
    } catch (err) {
      if (client) await db.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client?.release();
    }
  }

  /**
   * The session a superseded (already rotated) refresh-token hash belonged
   * to, or null. Used to detect replay of a leaked refresh token.
   * @param {string} hash
   */
  async findBySupersededRefreshTokenHash(hash) {
    const { rows } = await this.pool.query(
      `SELECT s.id, s.user_id, s.session_token, s.ip_address, s.user_agent, s.created_at, s.expires_at, s.is_active, s.metadata
         FROM refresh_token_history h JOIN user_sessions s ON s.id = h.session_id
        WHERE h.token_hash = $1`,
      [hash],
    );
    return rows[0] ? this._hydrate(rows[0]) : null;
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
