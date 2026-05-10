import { sendError } from './error-mapper.js';
import { UnauthorisedError } from '../../../../shared-kernel/domain/errors.js';
const BEARER_RE = /^Bearer\s+(.+)$/i;

/**
 * Build the auth middleware. Verifies `Authorization: Bearer <jwt>`,
 * checks the blacklist, and attaches authentication state to the request.
 *
 * # Request shape (dual exposure)
 *
 * The middleware sets two parallel views on the request so that both the
 * authoritative DDD-style principal AND legacy/alternative readers can lift
 * the actor without bespoke shims:
 *
 *   - `req.principal` — authoritative identity context. Shape:
 *       { userId, role, sessionId, jti, claims }
 *     New code SHOULD read from `req.principal`.
 *
 *   - `req.user` — compatibility view. Shape:
 *       { id, role, sessionId }
 *     The Workflow router (`createWorkflowRouter`) and several legacy
 *     handlers read `req.user.id`. Mirroring the principal here avoids
 *     a per-route shim and keeps both interfaces honest. The two views
 *     are populated in lock-step from the same JWT claims; they MUST
 *     be kept consistent.
 *
 *   - `req.actor` — Human-Interaction-style alias. Shape:
 *       { userId, sessionId }
 *     The Human Interaction router reads `req.actor.userId`. Same
 *     rationale as `req.user`: pre-populate from the principal so
 *     downstream code doesn't have to fall back through three layers
 *     of optional chains.
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
      const principal = {
        userId: claims.sub,
        role: claims.role,
        sessionId: claims.sid,
        jti: claims.jti,
        claims,
      };
      req.principal = principal;
      // Compatibility views for routers that haven't migrated to req.principal yet.
      // Both shapes are intentionally derived from the same principal so the
      // identifiers are guaranteed to match.
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
