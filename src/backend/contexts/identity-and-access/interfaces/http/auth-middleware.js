import { sendError } from './error-mapper.js';
import { UnauthorisedError } from '../../../../shared-kernel/domain/errors.js';
import { ApiKeySecret } from '../../domain/api-key/api-key-secret.js';
const BEARER_RE = /^Bearer\s+(.+)$/i;

/**
 * Build the auth middleware. Verifies `Authorization: Bearer <token>`,
 * checks the blacklist, and attaches authentication state to the request.
 *
 * Two token shapes are supported:
 *
 *   - JWT (default). Verified via `tokenIssuer.verifyAccess(token)` and
 *     filtered against `tokenBlacklist`. Sets `req.principal.via = 'jwt'`.
 *
 *   - API key. Recognised by the `glop_` prefix on the bearer value.
 *     Authenticated via the optional `authenticateWithApiKey` use case
 *     (omitted in dev/tests that don't wire API-key support). Sets
 *     `req.principal.via = 'api-key'`.
 *
 * # Request shape (dual exposure)
 *
 * The middleware sets two parallel views on the request so that both the
 * authoritative DDD-style principal AND legacy/alternative readers can lift
 * the actor without bespoke shims:
 *
 *   - `req.principal` — authoritative identity context. Shape:
 *       { userId, role, sessionId?, jti?, apiKeyId?, claims?, via }
 *   - `req.user` — compatibility view: { id, role, sessionId? }
 *   - `req.actor` — { userId, sessionId? }
 *
 * The three views are populated in lock-step from the same source.
 */
export function makeAuthMiddleware({
  tokenIssuer,
  tokenBlacklist,
  authenticateWithApiKey,
} = {}) {
  return async function authMiddleware(req, res, next) {
    try {
      const header = req.headers?.authorization ?? req.headers?.Authorization;
      if (!header) throw new UnauthorisedError('Missing Authorization header');
      const m = BEARER_RE.exec(header);
      if (!m) throw new UnauthorisedError('Malformed Authorization header');

      const raw = m[1];

      let principal;
      if (ApiKeySecret.looksLikeApiKey(raw)) {
        if (!authenticateWithApiKey) {
          throw new UnauthorisedError('API keys are not enabled');
        }
        const result = await authenticateWithApiKey.execute({ rawKey: raw });
        principal = {
          userId: result.userId,
          role: result.role,
          apiKeyId: result.apiKeyId,
          permissions: result.permissions ?? [],
          via: 'api-key',
        };
      } else {
        if (!tokenIssuer || typeof tokenIssuer.verifyAccess !== 'function') {
          throw new UnauthorisedError('JWT verifier not configured');
        }
        const claims = await tokenIssuer.verifyAccess(raw);
        if (claims.jti && tokenBlacklist) {
          const denied = await tokenBlacklist.isBlacklisted(claims.jti);
          if (denied) throw new UnauthorisedError('Token has been revoked');
        }
        principal = {
          userId: claims.sub,
          role: claims.role,
          sessionId: claims.sid,
          jti: claims.jti,
          claims,
          via: 'jwt',
        };
      }

      req.principal = principal;
      // Compatibility views for routers that haven't migrated to req.principal.
      req.user = {
        id: principal.userId,
        role: principal.role,
        sessionId: principal.sessionId,
      };
      req.actor = {
        userId: principal.userId,
        sessionId: principal.sessionId,
      };
      next();
    } catch (err) {
      sendError(res, err);
    }
  };
}
