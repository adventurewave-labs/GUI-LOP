/**
 * @typedef {import('../../domain/user/password-hash.js').PasswordHash} PasswordHash
 */

/**
 * PasswordHasher — port. Encapsulates the chosen hashing algorithm
 * (bcrypt today). The domain only ever sees opaque `PasswordHash`
 * VOs; plaintext never crosses the domain boundary.
 *
 * @typedef {Object} PasswordHasher
 * @property {(plaintext: string) => Promise<PasswordHash>} hash
 * @property {(plaintext: string, hash: PasswordHash) => Promise<boolean>} verify
 */
export const PasswordHasherSymbol = Symbol.for('iam.PasswordHasher');
