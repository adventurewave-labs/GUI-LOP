/**
 * auth-middleware-shape.test.js
 *
 * Verifies the dual-exposure contract introduced by Fix 1 of the DDD
 * integration sweep: when the middleware authenticates a request it MUST
 * populate `req.principal` (authoritative) and the compatibility shapes
 * `req.user` and `req.actor` from the same JWT claims, with identical
 * identifiers across all three views.
 */
import { makeAuthMiddleware } from '../../interfaces/http/auth-middleware.js';
import { JwtTokenIssuer } from '../../infrastructure/tokens/jwt-token-issuer.js';
import { InMemoryTokenBlacklist } from '../../infrastructure/cache/inmemory-token-blacklist.js';

function makeReqRes(headers = {}) {
  const req = { headers };
  let statusCode = 200;
  const sent = { status: 200, body: null };
  const res = {
    status(code) { statusCode = code; sent.status = code; return res; },
    json(body) { sent.body = body; return res; },
    setHeader() { return res; },
    get statusCode() { return statusCode; },
  };
  return { req, res, sent };
}

describe('makeAuthMiddleware — request shape', () => {
  const tokenIssuer = new JwtTokenIssuer({ secret: 'shape-test-secret' });
  const tokenBlacklist = new InMemoryTokenBlacklist();
  const middleware = makeAuthMiddleware({ tokenIssuer, tokenBlacklist });

  test('populates req.principal, req.user and req.actor from the same claims', async () => {
    const sub = 'user-12345';
    const role = 'reviewer';
    const sid = 'session-abcdef';
    const { token } = await tokenIssuer.issueAccess({ sub, role, sid }, 60);

    const { req, res } = makeReqRes({ authorization: `Bearer ${token}` });
    let nextCalled = false;
    await middleware(req, res, () => { nextCalled = true; });

    expect(nextCalled).toBe(true);
    expect(req.principal).toBeDefined();
    expect(req.principal.userId).toBe(sub);
    expect(req.principal.role).toBe(role);
    expect(req.principal.sessionId).toBe(sid);

    // Compatibility view used by the workflow router.
    expect(req.user).toBeDefined();
    expect(req.user.id).toBe(req.principal.userId);
    expect(req.user.role).toBe(req.principal.role);
    expect(req.user.sessionId).toBe(req.principal.sessionId);

    // Compatibility view used by the human-interaction router.
    expect(req.actor).toBeDefined();
    expect(req.actor.userId).toBe(req.principal.userId);
    expect(req.actor.sessionId).toBe(req.principal.sessionId);
  });

  test('does not populate any view when the Authorization header is missing', async () => {
    const { req, res, sent } = makeReqRes({});
    let nextCalled = false;
    await middleware(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(false);
    expect(sent.status).toBe(401);
    expect(req.principal).toBeUndefined();
    expect(req.user).toBeUndefined();
    expect(req.actor).toBeUndefined();
  });
});
