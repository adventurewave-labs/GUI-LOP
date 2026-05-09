# 0003. Adopt Domain-Driven Design

- **Status:** Accepted
- **Date:** 2025-10-26
- **Deciders:** Architecture Review Board, Product
- **Tags:** architecture, modelling, ddd

## Context

GUI-LOP coordinates non-trivial business processes: a workflow has
templates, steps, dynamically generated UI, human approvers with roles,
audit trails, and downstream notifications. Without an explicit modelling
discipline the codebase tends toward anaemic CRUD-over-tables — exactly
what failed in earlier prototypes where business rules ended up sprayed
across route handlers, validators, and frontend components.

We need a modelling approach that:

- Centralises business invariants (e.g. "a workflow cannot complete with
  unanswered human steps").
- Lets multiple teams own clearly-bounded slices of the system.
- Makes the language used in code match the language used by domain
  experts (workflow designers, operations, compliance).

## Decision

We will adopt Domain-Driven Design (DDD), both strategically and
tactically:

- **Strategic DDD**: identify subdomains (core/supporting/generic),
  define bounded contexts, and document a context map. See
  [docs/ddd/](../ddd/README.md).
- **Tactical DDD**: model business invariants inside aggregates, with
  entities, value objects, domain events, and repositories. Application
  services orchestrate use cases; infrastructure adapters live behind
  ports.
- **Ubiquitous language**: every bounded context maintains a glossary,
  and code identifiers must match the glossary terms (e.g. the entity is
  `Workflow`, not `Job`, `Process`, or `Task`).

## Alternatives Considered

- **CRUD-only / table-driven design** — fast to start, brittle as rules
  multiply. Rejected.
- **Clean Architecture without DDD vocabulary** — captures layering but
  not modelling discipline. Rejected as insufficient on its own.
- **Microservices first** — premature; would have us drawing service
  boundaries before we understand domain boundaries. Rejected.

## Consequences

### Positive

- Business rules are encoded near the data they protect.
- Bounded contexts give teams autonomy without coupling.
- The vocabulary in code, docs, and meetings is the same.

### Negative / Trade-offs

- Higher up-front modelling cost.
- Risk of over-engineering simple CRUD endpoints; we counter this by
  applying tactical DDD only inside the *core* subdomain.
- Requires onboarding material; provided in `docs/ddd/`.

### Neutral

- DDD is compatible with our hexagonal architecture (ADR 0004) and
  event-driven approach (ADR 0005).

## Compliance and Verification

- Each bounded context must have a `glossary.md`.
- Aggregates must enforce invariants in their methods, not via service
  code in the application layer.
- Code review checks that domain types do not import infrastructure.

## References

- Eric Evans, *Domain-Driven Design* (2003)
- Vaughn Vernon, *Implementing Domain-Driven Design* (2013)
- ADR 0004 — Hexagonal Architecture
- [DDD docs](../ddd/README.md)
