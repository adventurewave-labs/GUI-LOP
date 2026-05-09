# 0024. Idempotency for Workflow Mutating Endpoints

- **Status:** Accepted
- **Date:** 2025-10-26
- **Deciders:** Backend team
- **Tags:** api, reliability, idempotency

## Context

Networks fail, browsers retry, and scripts double-click. A user
submitting a human response, creating a workflow, or executing a
workflow may unintentionally trigger the same mutation twice. The
domain must not record two responses where the user submitted once.

## Decision

All mutating endpoints (`POST`, `PUT`, `PATCH`, `DELETE`) accept and
honour an `Idempotency-Key` request header. The server stores
`(user_id, route, idempotency_key)` → response for a 24-hour window:

- First request with a given key: process and persist response.
- Subsequent request with the same key and *the same body hash*:
  return the stored response.
- Same key, *different* body: respond `409 Conflict`.

Storage backend: Redis with TTL, falling back to a Postgres table for
durability beyond the cache window when audit requires it.

For workflow responses (the most sensitive case), the
`(workflow_id, step_id, idempotency_key)` triple is the unique key,
and the aggregate uses an optimistic-concurrency check on its
version (`updated_at` or a dedicated version column) to reject
concurrent stale writes with `409`.

Frontend SDKs generate keys automatically with `uuid-v4`.

## Alternatives Considered

- **No idempotency, retry yields duplicates** — clearly bad; rejected.
- **Server-side dedup by content hash only** — confuses retried
  duplicates with intentional repeats; rejected.

## Consequences

### Positive

- Safe retries from any client.
- Predictable behaviour for partner integrations.

### Negative / Trade-offs

- Request size grows by a header.
- Storage cost for the dedup ledger; bounded by TTL.

### Neutral

- We surface idempotency status in audit logs for compliance.

## Compliance and Verification

- API tests include duplicate-submission cases.
- A compliance check verifies every mutating route enforces an
  idempotency key when called from non-browser clients.

## References

- Stripe API: Idempotent Requests
- ADR 0012 — Human-in-the-Loop Coordination
