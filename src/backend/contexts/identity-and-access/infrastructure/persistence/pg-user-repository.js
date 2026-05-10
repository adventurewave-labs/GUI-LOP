import { ConflictError } from '../../shared-kernel-stubs.js';
import { EmailAddress } from '../../domain/user/email-address.js';
import { Username } from '../../domain/user/username.js';
import { PasswordHash } from '../../domain/user/password-hash.js';
import { RoleName } from '../../domain/user/role-name.js';
import { User } from '../../domain/user/user.js';

/**
 * Postgres UserRepository against the `users` table.
 * Pool/client must implement `query(sql, params)` returning `{ rows }`.
 */
export class PgUserRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async findById(id) {
    const { rows } = await this.pool.query(
      'SELECT id, email, username, password_hash, full_name, role, is_active, metadata, created_at, updated_at, last_login FROM users WHERE id = $1',
      [id],
    );
    return rows[0] ? this._hydrate(rows[0]) : null;
  }

  async findByEmail(email) {
    const target = email?.value ?? email;
    const { rows } = await this.pool.query(
      'SELECT id, email, username, password_hash, full_name, role, is_active, metadata, created_at, updated_at, last_login FROM users WHERE LOWER(email) = LOWER($1)',
      [target],
    );
    return rows[0] ? this._hydrate(rows[0]) : null;
  }

  async findByUsername(username) {
    const target = username?.value ?? username;
    const { rows } = await this.pool.query(
      'SELECT id, email, username, password_hash, full_name, role, is_active, metadata, created_at, updated_at, last_login FROM users WHERE username = $1',
      [target],
    );
    return rows[0] ? this._hydrate(rows[0]) : null;
  }

  async save(user) {
    // The schema in 01_main_schema.sql lacks an explicit version
    // column; we use updated_at as the optimistic-concurrency token.
    const params = [
      user.id,
      user.email.value,
      user.username.value,
      user.passwordHash.value,
      user.fullName,
      user.role.value,
      user.isActive,
      user.metadata,
      user.lastLogin,
    ];
    const result = await this.pool.query(
      `INSERT INTO users (id, email, username, password_hash, full_name, role, is_active, metadata, last_login)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE SET
         email = EXCLUDED.email,
         username = EXCLUDED.username,
         password_hash = EXCLUDED.password_hash,
         full_name = EXCLUDED.full_name,
         role = EXCLUDED.role,
         is_active = EXCLUDED.is_active,
         metadata = EXCLUDED.metadata,
         last_login = EXCLUDED.last_login,
         updated_at = NOW()
       RETURNING id`,
      params,
    );
    if (!result.rows[0]) {
      throw new ConflictError(`Failed to persist user ${user.id}`);
    }
  }

  /** @private */
  _hydrate(row) {
    return new User({
      id: row.id,
      email: new EmailAddress(row.email),
      username: new Username(row.username),
      passwordHash: PasswordHash.fromTrustedHash(row.password_hash),
      role: new RoleName(row.role),
      isActive: row.is_active,
      fullName: row.full_name,
      metadata: row.metadata ?? {},
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastLogin: row.last_login ?? null,
      version: 0,
    });
  }
}
