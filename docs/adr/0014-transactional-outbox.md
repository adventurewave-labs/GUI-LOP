# 0014. Transactional Outbox for Domain Events

- **Status:** Accepted
- **Date:** 2025-10-26
- **Deciders:** Backend team
- **Tags:** eventing, reliability, outbox

## Context

Several non-trivial flows must update state *and* notify the outside
world atomically:

- A workflow step completes → notifications to users, WebSocket fan-
  out, audit-log entry.
- A human response is recorded → state transition + notification +
  metric update.

Naive implementations publish to the message bus or WebSocket fan-
out *after* the database commit, which can lose events on crash. The
opposite (publish before commit) can publish events for transactions
that are later rolled back.

## Decision

We will use the **transactional outbox** pattern.

- Every domain event produced inside a transaction is written to an
  `outbox` table within the same transaction.
- A separate **outbox publisher** process (or background task in the
  same process for now) reads the outbox in order and publishes to:
  - Redis Pub/Sub (for WebSocket fan-out, ADR 0007),
  - the in-process domain event bus (for read-model and side-effect
    handlers),
  - external sinks (email, webhooks) as adapters.
- Publishers mark events as `dispatched`. A retry policy with backoff
  handles transient failures; a dead-letter table stores poison
  events for manual inspection.
- Consumers must be **idempotent**, keyed by event id.

`LISTEN`/`NOTIFY` (Postgres) is used to wake the publisher; it does
not replace the durable outbox row.

## Alternatives Considered

- **Event sourcing** — most robust; we don't need it now and the
  cost is high. Outbox gives us most of the benefits incrementally.
- **Two-phase commit / XA across DB and bus** — fragile and slow.
- **Publish then commit / commit then publish** — both lose events.

## Consequences

### Positive

- Atomicity: state and events agree.
- Replayable: the outbox is a record of what was decided.
- Decouples the slow path (notifications, webhooks) from the request
  path.

### Negative / Trade-offs

- Adds a publisher process (and its monitoring).
- Slight write amplification (one row per event).
- Subscribers must be idempotent.

### Neutral

- The outbox table is part of the schema (`outbox`), not in
  application code.

## Compliance and Verification

- Every command-side use case writes its events through the outbox
  port; direct publishes are forbidden by lint.
- Publisher lag (oldest undispatched event age) is a SLO metric
  (ADR 0021).
- A chaos test kills the publisher mid-flight to confirm at-least-
  once delivery.

## References

- Chris Richardson, "Pattern: Transactional Outbox"
- ADR 0007 — Redis
- ADR 0021 — Observability
