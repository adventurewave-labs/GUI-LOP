/**
 * @typedef {{ name: string, description?: string, permissions: import('../../domain/permission/permission.js').Permission[] }} Role
 */

/**
 * RoleRepository — port for Role lookups.
 *
 * @typedef {Object} RoleRepository
 * @property {(name: string) => Promise<Role|null>} findByName
 * @property {() => Promise<Role[]>} list
 */
export const RoleRepositorySymbol = Symbol.for('iam.RoleRepository');
