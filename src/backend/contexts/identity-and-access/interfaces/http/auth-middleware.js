import { sendError } from './error-mapper.js';
import { UnauthorisedError } from '../../shared-kernel-stubs.js';

const BEARER_RE = /^Bearer\s+(.+)$/i;

/**
 * Build the auth middleware. Verifies `Authorization: Bearer <jwt>`,
 * checks the blacklist, and attaches `req.principal`.
 */
export function makeAuthMiddleware({ tokenIssuer, tokenBlacklist }) {
  return async function authMiddleware(req, res, next) {
    try {
      const header = req.headers?.authorization ?? req.headers?.Authorization;
      if (!header) throw new UnauthorisedError('Missing Authorization header');
      const m = BEARER_RE.exec(header);
      if (!m) throw new UnauthorisedError('Malformed Authorization header');

      const claims = await tokenIssuer.verifyAccess(m[1]);
      if (claims.jti && tokenBlacklist) {
        const denied = await tokenBlacklist.isBlacklisted(claims.jti);
        if (denied) throw new UnauthorisedError('Token has been revoked');
      }
      req.principal = {
        userId: claims.sub,
        role: claims.role,
        sessionId: claims.sid,
        jti: claims.jti,
        claims,
      };
      next();
    } catch (err) {
      sendError(res, err);
    }
  };
}
