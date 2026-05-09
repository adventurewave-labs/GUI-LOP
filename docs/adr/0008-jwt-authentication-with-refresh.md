# 0008. JWT-Based Authentication with Refresh Tokens

- **Status:** Accepted
- **Date:** 2025-10-26
- **Deciders:** Security team, Backend team
- **Tags:** security, authentication, jwt

## Context

The platform requires authenticated access for both REST endpoints and
WebSocket connections. Sessions can be long (workflows wait days for
human input), but exposure windows for stolen tokens must be short.

We considered:

- Server-side sessions with a session cookie.
- Stateless JWTs.
- A hybrid: short-lived access JWTs plus refresh tokens stored
  server-side and revocable.

## Decision

We will use a hybrid model:

- **Access tokens**: signed JWTs (`HS256` for now; key in secrets
  manager — ADR 0022). Lifetime: 15 minutes. Carry user id, role,
  and minimal claims; never carry secrets or PII.
- **Refresh tokens**: opaque, random, server-side records in Postgres
  (`user_sessions`) with a hashed copy in Redis for fast lookup
  (ADR 0007). Lifetime: 7 days, sliding.
- **Token revocation**: a Redis-backed deny-list of access-token jti
  claims and refresh-token ids; checked on every request.
- **Transports**: tokens are passed via the `Authorization: Bearer`
  header for HTTP and the same header on the WebSocket upgrade request.
  Cookies are not used to avoid CSRF complexity for the SPA.

## Alternatives Considered

- **Cookie sessions only** — simpler, but harder to use across
  origins and from mobile clients; rejected.
- **Long-lived JWTs without revocation** — convenient, but a stolen
  token cannot be invalidated in a useful timeframe; rejected.
- **OAuth2/OIDC with an external IdP** — best for enterprise; planned
  but out of scope for the first cut. Captured as a future ADR.

## Consequences

### Positive

- Short access-token lifetime limits the blast radius of a leak.
- WebSocket and HTTP share the same auth scheme.
- Refresh tokens can be revoked centrally (e.g. password change,
  admin lockout).

### Negative / Trade-offs

- Two token types adds frontend complexity; mitigated by the API
  client wrapper.
- Revocation requires a Redis lookup on every request; sub-millisecond
  in practice and acceptable.
- Symmetric `HS256` requires careful secret management; a follow-up
  ADR will move us to `RS256` once a KMS is wired in.

### Neutral

- Compatible with future OIDC integration: refresh tokens become the
  IdP refresh; access tokens become IdP-issued JWTs.

## Compliance and Verification

- Auth middleware is centralised in `src/backend/middleware/auth-middleware.js`.
- Negative tests in `tests/security/` cover expired tokens,
  blacklisted tokens, tampered signatures, and missing claims.
- Token rotation is exercised by the load tests.

## References

- RFC 7519 (JWT), RFC 6749 (OAuth 2.0)
- `docs/AUTHENTICATION.md`
- ADR 0007 — Redis
- ADR 0022 — Secrets Management
