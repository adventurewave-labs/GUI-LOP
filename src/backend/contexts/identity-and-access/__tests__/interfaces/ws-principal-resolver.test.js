/**
 * ws-principal-resolver.test.js — WebSocket upgrade authentication.
 *
 * Regression guard for the pre-hardening behaviour where any client could
 * open a socket as any user by sending `X-User-Id`.
 */
import {
  makeWsPrincipalResolver,
  extractUpgradeToken,
} from '../../interfaces/websocket/ws-principal-resolver.js';
import { JwtTokenIssuer } from '../../infrastructure/tokens/jwt-token-issuer.js';
import { InMemoryTokenBlacklist } from '../../infrastructure/cache/inmemory-token-blacklist.js';

const upgrade = ({ url = '/ws/v1', headers = {} } = {}) => ({ url, headers });

describe('extractUpgradeToken', () => {
  test('reads Authorization bearer header', () => {
    expect(extractUpgradeToken(upgrade({ headers: { authorization: 'Bearer abc' } }))).toBe('abc');
  });

  test('reads Sec-WebSocket-Protocol "bearer, <token>"', () => {
    const req = upgrade({ headers: { 'sec-websocket-protocol': 'bearer, tok123' } });
    expect(extractUpgradeToken(req)).toBe('tok123');
  });

  test('reads ?token= and ?access_token= query params', () => {
    expect(extractUpgradeToken(upgrade({ url: '/ws/v1?token=q1' }))).toBe('q1');
    expect(extractUpgradeToken(upgrade({ url: '/ws/v1?access_token=q2&token=q1' }))).toBe('q2');
  });

  test('returns null when absent or oversized', () => {
    expect(extractUpgradeToken(upgrade())).toBeNull();
    expect(extractUpgradeToken(upgrade({ url: `/ws?token=${'a'.repeat(9000)}` }))).toBeNull();
    expect(extractUpgradeToken(undefined)).toBeNull();
  });
});

describe('makeWsPrincipalResolver', () => {
  const tokenIssuer = new JwtTokenIssuer({ secret: 'ws-resolver-secret' });
  let tokenBlacklist;
  let resolve;

  beforeEach(() => {
    tokenBlacklist = new InMemoryTokenBlacklist();
    resolve = makeWsPrincipalResolver({ tokenIssuer, tokenBlacklist });
  });

  test('requires a token verifier', () => {
    expect(() => makeWsPrincipalResolver({})).toThrow(TypeError);
  });

  test('accepts a valid access token and maps claims to a principal', async () => {
    const { token } = await tokenIssuer.issueAccess({ sub: 'u-1', role: 'editor', sid: 's-1' }, 60);
    const p = await resolve(upgrade({ url: `/ws/v1?token=${token}` }));
    expect(p).toEqual(
      expect.objectContaining({ id: 'u-1', role: 'editor', sessionId: 's-1', via: 'jwt' }),
    );
  });

  test('rejects X-User-Id without a token (default: header auth disabled)', async () => {
    await expect(resolve(upgrade({ headers: { 'x-user-id': 'victim' } }))).resolves.toBeNull();
  });

  test('rejects a token signed with another secret', async () => {
    const forger = new JwtTokenIssuer({ secret: 'attacker-secret' });
    const { token } = await forger.issueAccess({ sub: 'victim' }, 60);
    await expect(resolve(upgrade({ url: `/ws?token=${token}` }))).resolves.toBeNull();
  });

  test('rejects a revoked token', async () => {
    const { token, jti } = await tokenIssuer.issueAccess({ sub: 'u-2' }, 60);
    await tokenBlacklist.blacklist(jti, 60);
    await expect(resolve(upgrade({ url: `/ws?token=${token}` }))).resolves.toBeNull();
  });

  test('an invalid token does not fall through to header auth', async () => {
    const lax = makeWsPrincipalResolver({ tokenIssuer, allowHeaderAuth: true });
    const req = upgrade({ url: '/ws?token=garbage', headers: { 'x-user-id': 'victim' } });
    await expect(lax(req)).resolves.toBeNull();
  });

  test('allowHeaderAuth re-enables the dev-only X-User-Id path', async () => {
    const lax = makeWsPrincipalResolver({ tokenIssuer, allowHeaderAuth: true });
    await expect(lax(upgrade({ headers: { 'x-user-id': 'dev' } }))).resolves.toEqual({
      id: 'dev',
      via: 'insecure-header',
    });
  });

  test('API keys are rejected when no authenticator is wired', async () => {
    const req = upgrade({ headers: { authorization: 'Bearer glop_live_abcdefghijklmnopqrstuvwxyz0123456789' } });
    await expect(resolve(req)).resolves.toBeNull();
  });
});
