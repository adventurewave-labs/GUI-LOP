# 0015. Rate Limiting Strategy

- **Status:** Accepted
- **Date:** 2025-10-26
- **Deciders:** Security team, Backend team
- **Tags:** security, performance, rate-limit

## Context

Public-facing endpoints (login, registration, workflow creation) need
protection against abuse, brute-force attempts, and accidental
overload. WebSocket upgrade and message rates also need bounds.

We have multiple instances behind a load balancer (eventually), so
limits must be coordinated across processes — a per-process token
bucket is not enough.

## Decision

Rate limiting is layered:

1. **Edge / load balancer**: coarse limits per IP (e.g. 100 rps) at
   the load balancer or CDN. Catches volumetric abuse before the
   application sees it.
2. **Application middleware** (`express-rate-limit`-style with a
   Redis store, ADR 0007):
   - **Authentication endpoints**: stricter — e.g. 5 failed logins
     per IP per 15 min, 20 per account per hour.
   - **Workflow mutations**: per-user budget (e.g. 60 creates per
     hour for a `user` role; admins exempt).
   - **Read endpoints**: generous global ceiling.
3. **WebSocket**:
   - Upgrade rate per IP.
   - Message rate per connection (e.g. 30 msgs / 10s).
4. **Quotas (future)**: per-tenant resource quotas on workflows in
   flight, executions per day, total active steps.

All limits return `429 Too Many Requests` with a `Retry-After` header.
Limits are configurable per environment via the configuration
service (ADR 0022).

## Alternatives Considered

- **Sliding window log per request** — most accurate, more memory.
  Used only for low-volume sensitive paths (auth).
- **Token bucket only** — used as the default for high-volume paths.
- **No app-layer limits, rely on edge only** — rejected; edge cannot
  see authentication state and cannot enforce per-user budgets.

## Consequences

### Positive

- Brute-force resistance.
- Predictable resource usage per user.
- Coordinated across instances.

### Negative / Trade-offs

- Redis becomes a hard dependency for serving traffic. We design for
  graceful degradation (fail-open with logged warnings) when Redis is
  unavailable on non-auth endpoints; auth endpoints fail closed.

### Neutral

- Limits will be tuned post-launch from real telemetry.

## Compliance and Verification

- Each limit has an associated load test in `tests/load/scenarios/`.
- Headers `X-RateLimit-Limit`, `X-RateLimit-Remaining`,
  `X-RateLimit-Reset` are emitted on protected endpoints for client
  visibility.

## References

- OWASP API Security Top 10 (2023)
- `src/backend/services/rate-limit-service.js`
- ADR 0007 — Redis
