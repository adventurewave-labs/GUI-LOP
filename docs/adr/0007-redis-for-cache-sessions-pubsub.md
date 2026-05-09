# 0007. Redis for Caching, Sessions, and Pub/Sub

- **Status:** Accepted
- **Date:** 2025-10-26
- **Deciders:** Backend team, Platform team
- **Tags:** cache, sessions, pubsub, redis

## Context

Three concerns need a fast, in-memory data store:

1. **Caching** of hot reads (workflow templates, recent workflow status,
   user sessions) so we do not hit Postgres for every request.
2. **Sessions / token revocation lists** for JWTs (ADR 0008): expiring
   sessions, sliding refresh windows, and a fast deny-list for revoked
   tokens.
3. **Pub/Sub** to fan out WebSocket events across multiple backend
   instances behind a load balancer (ADR 0005).

Each could be a separate technology, but operating one engine for all
three reduces moving parts.

## Decision

We will use Redis 6+ for caching, session storage, distributed rate
limiting (ADR 0015), token blacklisting, and pub/sub. The relevant
service modules already exist in `src/backend/services/` and act as
infrastructure adapters behind ports declared by the application layer.

Conventions:

- Keys are namespaced: `gui-lop:<context>:<purpose>:<id>`.
- All keys carry a TTL; "forever" is not a valid Redis TTL in this
  system.
- Cache invalidation is event-driven via the domain event bus (ADR 0014).
- Pub/Sub channels mirror domain event names (e.g. `workflow.completed`).

## Alternatives Considered

- **Memcached** — pure cache, no Pub/Sub or persistence. Rejected: we
  need pub/sub and richer data structures.
- **NATS** — better pub/sub semantics. Rejected for the first phase to
  keep operational footprint small; revisit if delivery guarantees
  require it.
- **Postgres `LISTEN`/`NOTIFY` everywhere** — fine for the outbox
  publisher itself but not for multi-instance fan-out under load.

## Consequences

### Positive

- One ops surface for cache + sessions + pub/sub.
- Sub-millisecond reads for hot paths (templates, session validation).
- Multi-instance WebSocket fan-out works without sticky sessions.

### Negative / Trade-offs

- Redis is in-memory: capacity planning matters. We size to keep the
  working set in RAM and accept evictions for cold data.
- A Redis outage degrades performance and impacts session validation;
  we mitigate with replicas and graceful degradation (cache miss falls
  back to Postgres).
- Pub/Sub provides at-most-once delivery; durable side-effects must go
  through the outbox (ADR 0014).

### Neutral

- Redis configuration and HA strategy are documented in
  `infrastructure/`.

## Compliance and Verification

- A connection-pool health check is exposed at `/health` (cache
  subsystem).
- All cache reads have a documented invalidation path.
- Load tests `tests/load/scenarios/redis-load-test.js` exercise cache
  and pub/sub paths under target throughput.

## References

- Redis documentation
- `src/backend/services/redis-cache-service.js`
- ADR 0014 — Outbox
- ADR 0015 — Rate Limiting
