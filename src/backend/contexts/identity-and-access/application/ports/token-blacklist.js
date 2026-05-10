/**
 * TokenBlacklist — port. Backed by Redis SETEX in production; an
 * in-memory map in tests.
 *
 * @typedef {Object} TokenBlacklist
 * @property {(jti: string) => Promise<boolean>} isBlacklisted
 * @property {(jti: string, ttlSeconds: number) => Promise<void>} blacklist
 */
export const TokenBlacklistSymbol = Symbol.for('iam.TokenBlacklist');
