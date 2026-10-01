/**
 * ws-principal-resolver — authenticates WebSocket upgrade requests.
 *
 * Browsers cannot set arbitrary headers on `new WebSocket(...)`, so the
 * access token is accepted from (in priority order):
 *
 *   1. `Authorization: Bearer <token>`           (server-to-server clients)
 *   2. `Sec-WebSocket-Protocol: bearer, <token>` (browser, keeps the token
 *      out of URLs / access logs)
 *   3. `?token=<token>` / `?access_token=<token>` (frontend client default)
 *
 * The token is verified exactly like the HTTP auth middleware: JWT signature
 * + issuer/audience via `tokenIssuer.verifyAccess`, then the revocation
 * blacklist; `glop_` API keys go through `authenticateWithApiKey`.
 *
 * `allowHeaderAuth` re-enables the legacy unauthenticated `X-User-Id`
 * header for local development only (config refuses it in production).
 *
 * Returns `null` on any failure — the WS adapter maps that to a 401 and
 * never learns *why*, so we don't leak verification details on the wire.
 */

import { ApiKeySecret } from '../../domain/api-key/api-key-secret.js';

const BEARER_RE = /^Bearer\s+(.+)$/i;
const MAX_TOKEN_LEN = 8192;

/**
 * Pull a bearer credential out of an upgrade request.
 * @param {import('http').IncomingMessage} req
 * @returns {string|null}
 */
export function extractUpgradeToken(req) {
  const headers = req?.headers ?? {};

  const auth = headers.authorization;
  if (typeof auth === 'string') {
    const m = BEARER_RE.exec(auth);
    if (m) return sane(m[1]);
  }

  const proto = headers['sec-websocket-protocol'];
  if (typeof proto === 'string') {
    const parts = proto.split(',').map((s) => s.trim()).filter(Boolean);
    const idx = parts.findIndex((p) => p.toLowerCase() === 'bearer');
    if (idx !== -1 && parts[idx + 1]) return sane(parts[idx + 1]);
  }

  if (typeof req?.url === 'string' && req.url.includes('?')) {
    try {
      const url = new URL(req.url, 'http://localhost');
      const q = url.searchParams.get('access_token') ?? url.searchParams.get('token');
      if (q) return sane(q);
    } catch {
      /* malformed URL → no token */
    }
  }
  return null;
}

function sane(token) {
  const t = String(token).trim();
  if (!t || t.length > MAX_TOKEN_LEN) return null;
  return t;
}

/**
 * Build the `principalFromUpgrade` callback consumed by the notification
 * context's WebSocket adapter.
 *
 * @param {object} deps
 * @param {{ verifyAccess(token: string): Promise<object> }} deps.tokenIssuer
 * @param {{ isBlacklisted(jti: string): Promise<boolean> }} [deps.tokenBlacklist]
 * @param {{ execute(input: {rawKey: string}): Promise<object> }} [deps.authenticateWithApiKey]
 * @param {boolean} [deps.allowHeaderAuth=false]
 * @param {{ warn: Function }} [deps.logger]
 * @returns {(req: import('http').IncomingMessage) => Promise<object|null>}
 */
export function makeWsPrincipalResolver({
  tokenIssuer,
  tokenBlacklist,
  authenticateWithApiKey,
  allowHeaderAuth = false,
  logger,
} = {}) {
  if (!tokenIssuer || typeof tokenIssuer.verifyAccess !== 'function') {
    throw new TypeError('makeWsPrincipalResolver: tokenIssuer.verifyAccess is required');
  }

  return async function principalFromUpgrade(req) {
    const raw = extractUpgradeToken(req);

    if (raw) {
      try {
        if (ApiKeySecret.looksLikeApiKey(raw)) {
          if (!authenticateWithApiKey) return null;
          const r = await authenticateWithApiKey.execute({ rawKey: raw });
          return { id: r.userId, role: r.role, apiKeyId: r.apiKeyId, via: 'api-key' };
        }
        const claims = await tokenIssuer.verifyAccess(raw);
        if (!claims?.sub) return null;
        if (claims.jti && tokenBlacklist && (await tokenBlacklist.isBlacklisted(claims.jti))) {
          return null;
        }
        return {
          id: claims.sub,
          role: claims.role,
          sessionId: claims.sid,
          jti: claims.jti,
          exp: claims.exp,
          via: 'jwt',
        };
      } catch (err) {
        logger?.warn?.('ws upgrade rejected: invalid credential', {
          reason: err?.name ?? 'error',
        });
        return null;
      }
    }

    if (allowHeaderAuth) {
      const sub = req?.headers?.['x-user-id'];
      if (typeof sub === 'string' && sub.trim()) {
        return { id: sub.trim(), via: 'insecure-header' };
      }
    }
    return null;
  };
}
