import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { UnauthorisedError } from '../../../../shared-kernel/domain/errors.js';
/**
 * JwtTokenIssuer — HS256, configurable secret.
 */
export class JwtTokenIssuer {
  constructor({ secret, issuer = 'gui-lop', audience = 'gui-lop-api' } = {}) {
    if (!secret) throw new Error('JwtTokenIssuer requires a secret');
    this.secret = secret;
    this.issuer = issuer;
    this.audience = audience;
  }

  /**
   * @param {Object} claims
   * @param {number} ttlSeconds
   */
  async issueAccess(claims, ttlSeconds) {
    const jti = claims.jti ?? randomUUID();
    const payload = { ...claims, jti };
    const token = jwt.sign(payload, this.secret, {
      algorithm: 'HS256',
      expiresIn: ttlSeconds,
      issuer: this.issuer,
      audience: this.audience,
    });
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    return { token, jti, expiresAt };
  }

  async verifyAccess(token) {
    try {
      return jwt.verify(token, this.secret, {
        algorithms: ['HS256'],
        issuer: this.issuer,
        audience: this.audience,
      });
    } catch (err) {
      throw new UnauthorisedError(`Invalid token: ${err.message}`);
    }
  }
}
