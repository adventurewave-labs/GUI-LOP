# 0017. URL-Based API Versioning

- **Status:** Accepted
- **Date:** 2025-10-26
- **Deciders:** API team, Frontend team
- **Tags:** api, versioning

## Context

The platform exposes both REST endpoints and WebSocket message
schemas to multiple clients (the SPA, automated demo scripts, future
external integrators). Breaking changes are inevitable. We need a
versioning scheme that:

- Lets us introduce breaking changes without taking the world offline.
- Is debuggable (visible in URLs, logs, traces).
- Works equally for HTTP and WebSocket.

## Decision

- **REST**: URL-based major versioning under `/api/v{N}/...` for
  every public path. The current paths under `/api/...` will move to
  `/api/v1/...` with a routing alias for backward compatibility for
  one minor release.
- **WebSocket**: the upgrade URL carries a major version
  (`/ws/v{N}`), and message envelopes include a `version` field
  matching the major. Clients that send unknown versions get a
  `1003` close.
- **Backward compatibility window**: each `vN` is supported for at
  least 6 months after `v(N+1)` ships. Removal is announced via
  release notes and deprecation headers (`Deprecation`, `Sunset`).
- **Within a major**, only additive changes are allowed (new fields,
  new endpoints, new optional parameters). Field removal or
  semantic change requires a new major version.

## Alternatives Considered

- **Header-based versioning (`Accept: application/vnd.gui-lop.v1+json`)**
  — semantically clean, but harder to debug from a browser dev tools
  view and harder to cache. Rejected as the primary scheme.
- **Query parameter versioning (`?v=1`)** — caching pitfalls, easy
  to forget. Rejected.
- **No versioning** — only viable for purely internal APIs; rejected.

## Consequences

### Positive

- Trivially visible in logs and curl invocations.
- Routing per version is straightforward.
- Frontend and backend can ship at different cadences.

### Negative / Trade-offs

- Major versions accumulate code; we mitigate with shared adapters
  that map old shapes to new domain objects.
- Documentation must be versioned alongside.

### Neutral

- The first cut ships as `v1` immediately; there is no `v0`.

## Compliance and Verification

- The router lints prevent registering paths outside `/api/v{N}/`.
- A contract test pins each version against a stored OpenAPI doc.

## References

- ADR 0005 — WebSockets
- `src/api/docs/` (OpenAPI specs)
