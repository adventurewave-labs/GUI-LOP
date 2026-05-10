# Bounded Context: Identity & Access

> **Subdomain.** Supporting.
> **Status.** Active.
> **Owner.** Security team (with backend support).
> **Code.** `src/backend/contexts/identity-and-access/`

## Purpose

Authenticate users, manage sessions, and answer authorisation
questions for the rest of the platform. Encapsulate password and
token handling so that no other context touches credentials directly.

## Ubiquitous Language (Local Additions)

- **Principal** — generic "who" performing an action; either a
  `User` or a system component.
- **Access Token** — short-lived JWT.
- **Refresh Token** — long-lived opaque token, stored hashed.
- **Permission** — `<resource>:<action>`, optionally scoped.
- **Scope** — a resource id (workflow id, template key, future:
  organization id) that narrows a permission to a specific
  resource.

## Aggregates

### `User`

```
User
├── identity: UserId
├── email: EmailAddress (VO)
├── username: Username (VO)
├── password_hash: PasswordHash (VO)
├── full_name?
├── role: RoleName (VO, default 'user')
├── is_active: boolean
├── metadata: JSONB
├── created_at, updated_at, last_login?
└── pending_events
```

Invariants:

- `email` and `username` unique.
- `password_hash` cannot be set from a plaintext value at the
  domain layer — only via the `PasswordHasher` port.
- A deactivated user cannot start new sessions.

Behaviour: `register`, `changeEmail`, `changeUsername`,
`changePassword`, `deactivate`, `reactivate`, `recordLogin`.

### `Session`

```
Session
├── identity: SessionId
├── user_id: UserId
├── refresh_token_hash: opaque
├── ip: IPAddress (VO)
├── user_agent
├── created_at, expires_at, last_seen_at
├── is_active: boolean
└── pending_events
```

Invariants:

- Expired or revoked sessions are forever unusable.
- A refresh exchange replaces the refresh-token hash atomically.

### `Role`

```
Role
├── identity: RoleName
├── description
└── permissions: Permission[]
```

System roles (`admin`, `user`, `viewer`) are seeded. Custom roles
are not part of v1.

### `ApiKey`

For service-to-service and CLI/CI use. The plaintext key is generated
once (`glop_<43-base64url>`), returned to the caller of `mint()`, and
*never* persisted; only the SHA-256 hex digest is stored. Holds:

```
ApiKey
├── identity: ApiKeyId (branded UUID)
├── user_id: UserId
├── name: string
├── key_hash: sha256 hex
├── permissions: Permission[]
├── created_at, expires_at?, revoked_at?, last_used_at?
├── is_active: boolean
└── pending_events
```

Behaviour: `mint({user, name, permissions, expiresAt?, idGen, clock})`
(static, returns `{aggregate, plaintextKey}`), `revoke(now)`,
`recordUsage(now)`, `isUsable(now)`.

Invariants:

- Plaintext is returned exactly once.
- Revoked keys can never authenticate (irreversible).
- Expired keys silently fail authentication.
- Only the SHA-256 digest of the prefixed plaintext is stored.

Events: `api_key.minted`, `api_key.revoked`, `api_key.used`.

## Domain Services

- `PasswordHasher` (port; impl uses bcrypt) — `hash`, `verify`.
- `TokenIssuer` (port) — `issueAccessToken(claims): Jwt`,
  `issueRefreshToken(): RefreshTokenSecret`.
- `TokenVerifier` (port) — verifies signature, expiry, blacklist.
- `AuthorisationService` — `isAuthorised(user, permission, scope?)`.

## Use Cases

### Commands

- `RegisterUser({ email, username, password, role? })`
- `AuthenticateUser({ identifier, password, ip, user_agent })` →
  `(access_token, refresh_token)`
- `RefreshSession({ refresh_token })` → new `(access, refresh)`.
- `RevokeSession({ session_id })`
- `ChangePassword({ user_id, old, new })`
- `GrantPermission({ user_id, permission, scope? })`
- `RevokePermission({ user_id, permission, scope? })`
- `MintApiKey({ actor_user_id, actor_role, user_id, name, permissions?, expires_at? })`
  → `{ id, plaintextKey, ... }` (plaintext returned once)
- `RevokeApiKey({ actor_user_id, actor_role, api_key_id })`
- `AuthenticateWithApiKey({ raw_key })` → principal (used by middleware)
- `DeactivateUser({ actor_role, user_id })` (admin only)
- `ReactivateUser({ actor_role, user_id })` (admin only)

### Queries

- `GetUserProfile(user_id)`
- `ListUserSessions(user_id)`
- `ListApiKeysForUser({ actor_user_id, actor_role, user_id })`
- `ListUsers({ limit?, offset? })` (admin only via the router)

## Repositories

- `UserRepository`, `SessionRepository`, `RoleRepository`,
  `ApiKeyRepository`.

## Inbound Adapters

### REST (under `/api/v1/auth`)

| Method | Path             | Use Case            |
| ------ | ---------------- | ------------------- |
| POST   | `/register`      | `RegisterUser`      |
| POST   | `/login`         | `AuthenticateUser`  |
| POST   | `/refresh`       | `RefreshSession`    |
| POST   | `/logout`        | `RevokeSession`     |
| POST   | `/password`      | `ChangePassword`    |
| GET    | `/me`            | `GetUserProfile`    |

### REST — API keys (under `/api/v1/auth/api-keys`)

| Method | Path           | Use Case               |
| ------ | -------------- | ---------------------- |
| POST   | `/`            | `MintApiKey` (returns plaintext exactly once) |
| GET    | `/`            | `ListApiKeysForUser`   |
| DELETE | `/:id`         | `RevokeApiKey`         |

The principal may operate on their own keys; admins may pass `?userId=`
or a body `userId` to manage other users' keys.

### REST — Admin (under `/api/v1/admin`)

All endpoints require `principal.role === 'admin'` (enforced by
`adminGuard`). 401 on missing token, 403 on non-admin (envelope:
`{ success: false, code: 'forbidden', message: 'admin only' }`).

| Method | Path                                              | Use Case                |
| ------ | ------------------------------------------------- | ----------------------- |
| GET    | `/users`                                          | `ListUsers` (paginated) |
| GET    | `/users/:id`                                      | `GetUserProfile`        |
| POST   | `/users/:id/permissions`                          | `GrantPermission`       |
| DELETE | `/users/:id/permissions/:permission?scope=`       | `RevokePermission`      |
| POST   | `/users/:id/deactivate`                           | `DeactivateUser`        |
| POST   | `/users/:id/reactivate`                           | `ReactivateUser`        |

### Authentication Middleware

A single Express middleware accepts `Authorization: Bearer <token>`.
Two token shapes are supported, distinguished by prefix:

- A token starting with `glop_` is treated as an API key and verified
  via `AuthenticateWithApiKey`. The principal carries
  `via: 'api-key'` and `apiKeyId` for audit.
- Anything else is verified as a JWT via `TokenIssuer.verifyAccess`,
  filtered against the blacklist. Principal carries `via: 'jwt'`.

In both cases the middleware populates `req.principal`, `req.user`, and
`req.actor` from the same source. WebSocket upgrade goes through the
same path.

## Outbound Dependencies

- **Outbox** (port).
- **Cache** (port) for token blacklist and session lookup; backed by
  Redis (ADR 0007).

## Domain Events Produced

- `user.registered`, `user.deactivated`, `user.reactivated`
- `user.authenticated`, `user.authentication_failed`
- `session.created`, `session.refreshed`, `session.revoked`
- `role.granted`, `permission.granted`, `permission.revoked`
- `api_key.minted`, `api_key.revoked`, `api_key.used`

## Persistence

- `users`, `roles`, `user_sessions`, `api_keys`,
  `user_permissions` (migration `009_user_permissions.sql` — durable
  store for per-user scoped grants; the in-memory grants repository is
  used in dev/CI).

## Security Notes

- Passwords: bcrypt with work factor configured per environment;
  rotation policy in `docs/SECURITY_AUTHENTICATION_DOCUMENTATION.md`.
- Tokens: HS256 today, RS256 with KMS planned (see ADR 0008).
- Brute-force protection via rate limiting on `/login` (ADR 0015).
- Failed logins emit events used by anomaly detection.

## Risks and Pitfalls

- **JWT in localStorage** is the SPA's chosen pattern; the backend
  is agnostic, but storage choices interact with XSS posture. The
  frontend mitigates with strict CSP and short access-token TTL.
- **Permission explosion**: as scoped permissions grow, the
  decision logic can become slow. Cache evaluations per request and
  invalidate on relevant events.

## Open Questions

- **External IdP integration (OIDC).** Planned; will introduce a
  bridge that issues local sessions on top of IdP authentication.
- **Multi-tenancy.** When introduced, scopes will include
  `organization_id`; the data model is ready (`metadata` JSONB), the
  domain types will gain an `OrganizationId` VO.
