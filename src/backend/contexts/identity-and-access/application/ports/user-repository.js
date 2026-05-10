/**
 * @typedef {import('../../domain/user/user.js').User} User
 * @typedef {import('../../domain/user/email-address.js').EmailAddress} EmailAddress
 * @typedef {import('../../domain/user/username.js').Username} Username
 */

/**
 * UserRepository — port for User aggregate persistence.
 *
 * @typedef {Object} UserRepository
 * @property {(id: string) => Promise<User|null>} findById
 * @property {(email: EmailAddress) => Promise<User|null>} findByEmail
 * @property {(username: Username) => Promise<User|null>} findByUsername
 * @property {(user: User, uow?: object) => Promise<void>} save
 *   Persists the aggregate state plus its pending events. Uses
 *   optimistic concurrency on `user.version`.
 */
export const UserRepositorySymbol = Symbol.for('iam.UserRepository');
