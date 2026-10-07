// @ts-check
/**
 * Access-token revocation (roadmap 17b).
 *
 * JWT access tokens are stateless, so revoking a session (logout, refresh
 * token reuse, admin action) used to leave every access token already issued
 * for it valid until expiry — 15 minutes by default, and logout only
 * blacklisted the single token that made the request. A revoked session's id
 * is now written to the token blacklist for one access-token lifetime, and
 * every verifier rejects tokens whose `sid` is on it. One Redis GET per
 * request in production, same as the existing `jti` check.
 */

/** Blacklist key for a whole session (namespaced apart from jti entries). */
export const sessionRevocationKey = (sid) => `sid:${sid}`;

/**
 * @param {{ jti?: string, sid?: string }} claims
 * @param {{ isBlacklisted(key: string): Promise<boolean> } | null | undefined} blacklist
 * @returns {Promise<false | 'token' | 'session'>} why the token is revoked, or false
 */
export async function accessTokenRevocation(claims, blacklist) {
  if (!blacklist) return false;
  if (claims.jti && (await blacklist.isBlacklisted(claims.jti))) return 'token';
  if (claims.sid && (await blacklist.isBlacklisted(sessionRevocationKey(claims.sid)))) return 'session';
  return false;
}

/**
 * Decorate a SessionRepository so that persisting an inactive session also
 * revokes its outstanding access tokens. Centralised here so no revocation
 * path (logout, reuse detection, future admin "sign out everywhere") can
 * forget to do it.
 *
 * @template {{ save(s: any): Promise<void>, revoke?: (id: string, now?: Date) => Promise<void> }} R
 * @param {R} repo
 * @param {{ blacklist(key: string, ttlSeconds: number): Promise<void> }} blacklist
 * @param {{ accessTtlSeconds: number }} opts
 * @returns {R}
 */
export function withAccessTokenRevocation(repo, blacklist, { accessTtlSeconds }) {
  const ttl = Math.max(1, Math.floor(accessTtlSeconds));
  return new Proxy(repo, {
    get(target, prop, receiver) {
      if (prop === 'save') {
        return async (session) => {
          await target.save(session);
          if (session && session.isActive === false) {
            await blacklist.blacklist(sessionRevocationKey(session.id), ttl);
          }
        };
      }
      if (prop === 'revoke' && typeof target.revoke === 'function') {
        return async (sessionId, now) => {
          await target.revoke?.(sessionId, now);
          await blacklist.blacklist(sessionRevocationKey(sessionId), ttl);
        };
      }
      const v = Reflect.get(target, prop, receiver);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}
