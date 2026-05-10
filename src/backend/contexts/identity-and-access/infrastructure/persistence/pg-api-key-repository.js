import { ApiKey } from '../../domain/api-key/api-key.js';
import { ApiKeyId } from '../../domain/api-key/api-key-id.js';
import { Permission } from '../../domain/permission/permission.js';

/**
 * Postgres ApiKeyRepository against the `api_keys` table from
 * `database/schemas/01_main_schema.sql`. Columns:
 *
 *   id, user_id, key_name, api_key_hash, permissions JSONB, is_active,
 *   expires_at, last_used, created_at, updated_at
 *
 * The schema does not have an explicit `revoked_at` column; we model
 * revocation as `is_active = false` and a `last_used` write is treated
 * as `last_used_at`. When migrations move forward we can split these
 * concerns — the aggregate is already prepared.
 */
export class PgApiKeyRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async findById(id) {
    const value = id?.value ?? id;
    const { rows } = await this.pool.query(
      `SELECT id, user_id, key_name, api_key_hash, permissions, is_active,
              expires_at, last_used, created_at, updated_at
         FROM api_keys WHERE id = $1`,
      [value],
    );
    return rows[0] ? this._hydrate(rows[0]) : null;
  }

  async findByHash(hash) {
    const { rows } = await this.pool.query(
      `SELECT id, user_id, key_name, api_key_hash, permissions, is_active,
              expires_at, last_used, created_at, updated_at
         FROM api_keys WHERE api_key_hash = $1`,
      [hash],
    );
    return rows[0] ? this._hydrate(rows[0]) : null;
  }

  async findActiveByUser(userId) {
    const { rows } = await this.pool.query(
      `SELECT id, user_id, key_name, api_key_hash, permissions, is_active,
              expires_at, last_used, created_at, updated_at
         FROM api_keys
        WHERE user_id = $1 AND is_active = true
        ORDER BY created_at DESC`,
      [userId],
    );
    return rows.map((r) => this._hydrate(r));
  }

  async save(apiKey) {
    const params = [
      apiKey.id.value,
      apiKey.userId,
      apiKey.name,
      apiKey.keyHash,
      JSON.stringify(apiKey.permissions.map((p) => p.value)),
      apiKey.isActive,
      apiKey.expiresAt,
      apiKey.lastUsedAt,
    ];
    await this.pool.query(
      `INSERT INTO api_keys (id, user_id, key_name, api_key_hash, permissions,
                             is_active, expires_at, last_used)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET
         key_name = EXCLUDED.key_name,
         permissions = EXCLUDED.permissions,
         is_active = EXCLUDED.is_active,
         expires_at = EXCLUDED.expires_at,
         last_used = EXCLUDED.last_used,
         updated_at = NOW()`,
      params,
    );
  }

  /** @private */
  _hydrate(row) {
    const perms = (row.permissions ?? []).map((p) => new Permission(p));
    return new ApiKey({
      id: ApiKeyId.of(row.id),
      userId: row.user_id,
      name: row.key_name,
      keyHash: row.api_key_hash,
      permissions: perms,
      createdAt: row.created_at,
      expiresAt: row.expires_at ?? null,
      revokedAt: row.is_active === false ? row.updated_at ?? null : null,
      lastUsedAt: row.last_used ?? null,
      isActive: row.is_active,
    });
  }
}
