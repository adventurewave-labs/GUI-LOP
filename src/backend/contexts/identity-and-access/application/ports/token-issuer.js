/**
 * TokenIssuer — port for issuing/verifying JWT access tokens.
 *
 * @typedef {Object} TokenClaims
 * @property {string} sub          User id.
 * @property {string} role         Role name.
 * @property {string} sid          Session id.
 * @property {string} jti          Token id (used by blacklist).
 * @property {number} [iat]        Issued-at (seconds since epoch).
 * @property {number} [exp]        Expiry (seconds since epoch).
 *
 * @typedef {Object} TokenIssuer
 * @property {(claims: Omit<TokenClaims,'jti'|'iat'|'exp'> & { jti?: string }, ttlSeconds: number) => Promise<{ token: string, jti: string, expiresAt: Date }>} issueAccess
 * @property {(jwt: string) => Promise<TokenClaims>} verifyAccess
 */
export const TokenIssuerSymbol = Symbol.for('iam.TokenIssuer');
