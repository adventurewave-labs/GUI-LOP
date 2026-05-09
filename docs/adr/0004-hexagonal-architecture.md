# 0004. Hexagonal (Ports & Adapters) Architecture

- **Status:** Accepted
- **Date:** 2025-10-26
- **Deciders:** Architecture Review Board
- **Tags:** architecture, layering

## Context

We have agreed to model the domain with DDD (ADR 0003). To keep the
domain model independent of HTTP, WebSockets, PostgreSQL, Redis, and
specific AI provider SDKs, we need an explicit layering convention.

Without one, infrastructure leaks into the domain (e.g. `pg` queries
inside aggregates, Express `req`/`res` shapes flowing into business
logic), making the system hard to test, hard to migrate, and hard to
reason about.

## Decision

We will adopt the Hexagonal (Ports and Adapters) Architecture per
bounded context.

The structure inside each bounded context is:

```
contexts/<context>/
├── domain/             # Pure: entities, value objects, aggregates,
│                       # domain services, domain events. No I/O.
├── application/        # Use cases (commands/queries),
│                       # ports (interfaces), application services.
├── infrastructure/     # Adapters: repositories, external clients,
│                       # serialisers, message brokers.
└── interfaces/         # Inbound adapters: HTTP routes, WebSocket
                        # handlers, CLI, scheduled jobs.
```

Rules:

- `domain/` imports nothing from `application/`, `infrastructure/`, or
  `interfaces/`.
- `application/` imports `domain/` and defines ports as interfaces.
- `infrastructure/` and `interfaces/` import `application/` and
  `domain/`, and *implement* ports.
- Cross-context coupling happens only at the application layer through
  published events (ADR 0014) or explicit context-bridge interfaces.

## Alternatives Considered

- **Three-tier MVC** (controller → service → DAO) — works for CRUD but
  encourages mixing domain logic into services. Rejected.
- **Clean Architecture with full Onion layering** — equivalent in
  effect; we use the term "hexagonal" because it emphasises ports and
  adapters which match how we test.
- **Vertical slices only** — useful within a context, but doesn't
  enforce boundaries between contexts. Adopted *inside* a context for
  use-case organisation but on top of the hex layout.

## Consequences

### Positive

- Domain is unit-testable without a database, HTTP server, or network.
- Switching adapters (e.g. Redis → in-memory cache for tests) is a
  configuration change.
- New transports (CLI, gRPC) plug in as new inbound adapters without
  touching domain code.

### Negative / Trade-offs

- More files and more interface declarations.
- New contributors need to learn where things go.

### Neutral

- Compatible with CQRS-lite (ADR 0013) and the outbox pattern (ADR 0014).

## Compliance and Verification

- `eslint` import-boundary rule (or `dependency-cruiser`) enforces the
  layering. Violations fail CI.
- Code-review checklist: "no `pg`, `express`, `ws`, or `redis` imports
  in `domain/` or `application/`".
- Per-context architecture diagram lives in
  `docs/ddd/03-bounded-contexts/<context>.md`.

## References

- Alistair Cockburn, "Hexagonal Architecture" (2005)
- Vaughn Vernon, *Implementing Domain-Driven Design*, ch. 4
- ADR 0003 — Adopt DDD
- ADR 0013 — CQRS Lite
