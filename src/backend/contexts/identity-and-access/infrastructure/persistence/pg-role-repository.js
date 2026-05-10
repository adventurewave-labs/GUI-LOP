import { Permission } from '../../domain/permission/permission.js';

/**
 * Postgres RoleRepository against the `roles` table.
 * `permissions` is a JSONB array of canonical permission strings.
 */
export class PgRoleRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async findByName(name) {
    const { rows } = await this.pool.query(
      'SELECT name, description, permissions FROM roles WHERE name = $1',
      [name],
    );
    return rows[0] ? this._hydrate(rows[0]) : null;
  }

  async list() {
    const { rows } = await this.pool.query(
      'SELECT name, description, permissions FROM roles ORDER BY name',
    );
    return rows.map((r) => this._hydrate(r));
  }

  /** @private */
  _hydrate(row) {
    const list = Array.isArray(row.permissions) ? row.permissions : [];
    return {
      name: row.name,
      description: row.description ?? '',
      permissions: list.map((p) => (typeof p === 'string' ? new Permission(p) : new Permission(`${p.resource}:${p.action}${p.scope ? `@${p.scope}` : ''}`))),
    };
  }
}
