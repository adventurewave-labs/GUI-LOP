// @ts-check
import { Permission } from '../../domain/permission/permission.js';
import { isUuid, idValue } from '../../../../shared-kernel/infrastructure/ids.js';

/**
 * Postgres grants repository — direct (non-role) per-user permissions in
 * `user_permissions` (migration 009). Same port as `InMemoryGrantsRepository`.
 *
 * Until this adapter existed, production wired the in-memory repository even
 * with a database configured, so grants vanished on restart and diverged
 * between pods.
 *
 * Shape: `permission` holds `resource:action`, `scope` the optional scope.
 * Revocation is soft (`revoked_at`), preserving the audit trail; the partial
 * unique index `uq_user_permissions_active` makes `add` idempotent.
 */
export class PgGrantsRepository {
  /** @param {{ query: Function }} pool */
  constructor(pool) {
    this.pool = pool;
  }

  /**
   * Active grants for a user, oldest first.
   * @param {string | { value: string }} userId
   * @returns {Promise<Permission[]>}
   */
  async list(userId) {
    if (!isUuid(userId)) return [];
    const { rows } = await this.pool.query(
      `SELECT permission, scope FROM user_permissions
        WHERE user_id = $1 AND revoked_at IS NULL
        ORDER BY granted_at, id`,
      [idValue(userId)],
    );
    return rows.map((r) => new Permission(r.scope ? `${r.permission}@${r.scope}` : r.permission));
  }

  /**
   * Grant (idempotent: an existing active grant is left untouched).
   * @param {string | { value: string }} userId
   * @param {Permission} permission
   * @param {{ grantedBy?: string | null }} [opts]
   */
  async add(userId, permission, { grantedBy = null } = {}) {
    await this.pool.query(
      `INSERT INTO user_permissions (user_id, permission, scope, granted_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, permission, COALESCE(scope, '')) WHERE revoked_at IS NULL
       DO NOTHING`,
      [idValue(userId), `${permission.resource}:${permission.action}`, permission.scope ?? null, grantedBy],
    );
  }

  /**
   * Soft-revoke the active grant matching resource:action and scope exactly.
   * @param {string | { value: string }} userId
   * @param {Permission} permission
   */
  async remove(userId, permission) {
    if (!isUuid(userId)) return;
    await this.pool.query(
      `UPDATE user_permissions SET revoked_at = NOW()
        WHERE user_id = $1 AND permission = $2
          AND scope IS NOT DISTINCT FROM $3 AND revoked_at IS NULL`,
      [idValue(userId), `${permission.resource}:${permission.action}`, permission.scope ?? null],
    );
  }
}
