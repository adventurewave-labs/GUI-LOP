# 0013. CQRS Lite for Workflow Reads and Writes

- **Status:** Accepted
- **Date:** 2025-10-26
- **Deciders:** Backend team, Architecture Review Board
- **Tags:** architecture, cqrs, performance

## Context

Workflow read patterns and write patterns differ:

- **Writes** are aggregate-scoped, must enforce invariants, and are
  relatively low-frequency (state transitions only).
- **Reads** include dashboards, analytics views (`active_workflows`,
  `workflow_analytics`, `user_activity`), and per-workflow detail
  pages. They join across templates, users, responses, and metrics.

Forcing reads to go through aggregate roots leads to N+1 lookups and
slow dashboards. Conversely, letting writes touch arbitrary tables
violates aggregate boundaries and erodes invariants.

## Decision

We will adopt **CQRS Lite**:

- **Command side**: mutations go through application services that
  load aggregates via repositories, mutate, and persist. Aggregate
  invariants are enforced in the domain layer (ADR 0004).
- **Query side**: reads bypass aggregates and use *query services*
  that issue SQL directly against read models (views or denormalised
  tables). Query services live in `application/queries/` and return
  view-model DTOs.
- **Same database**: command and query sides share Postgres; we do
  *not* spin up a separate read store. If pressure grows, we can
  introduce a CDC pipeline to a search index without changing the
  call sites.

## Alternatives Considered

- **Full CQRS with separate stores and event sourcing** — heavier;
  defer until justified.
- **Strict ORM through aggregates for everything** — clean but slow
  on dashboards.
- **Plain repository with DTO projections only** — what we already
  do for some endpoints; we're formalising it.

## Consequences

### Positive

- Dashboards stay fast because they query views directly.
- Aggregates remain narrow and write-focused, which keeps invariants
  testable.
- Migration path to full CQRS or read replicas is simple.

### Negative / Trade-offs

- Two coding styles for reads vs writes; we mitigate with a clear
  directory convention (`application/commands/`, `application/queries/`).
- Read models need to be evolved alongside aggregates; we treat them
  as part of the same bounded context.

### Neutral

- Compatible with the outbox pattern (ADR 0014); read-model
  refreshes can be event-driven if we ever externalise them.

## Compliance and Verification

- Lint rule: query-service files must not import repository
  interfaces (and vice versa).
- Architecture diagrams in each context call out the read/write split.

## References

- ADR 0004 — Hexagonal Architecture
- ADR 0014 — Outbox Pattern
