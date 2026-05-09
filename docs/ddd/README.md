# Domain-Driven Design Documentation

This directory contains the Domain-Driven Design (DDD) artefacts for
the **GUI-LOP** platform: strategic design (vision, subdomains,
bounded contexts, context map), tactical design (aggregates, entities,
value objects, events, services, repositories), and per-context
implementation guides.

If you are new to the platform, read in this order:

1. [Domain Vision](01-strategic-design/domain-vision.md) — what
   problem we solve and for whom.
2. [Ubiquitous Language](01-strategic-design/ubiquitous-language.md) —
   the words we use, exactly.
3. [Subdomains](01-strategic-design/subdomains.md) — core, supporting,
   generic.
4. [Bounded Contexts](01-strategic-design/bounded-contexts.md) — the
   six contexts we ship.
5. [Context Map](01-strategic-design/context-map.md) — how contexts
   relate.
6. [Tactical Design](02-tactical-design/) — modelling building blocks
   used inside contexts.
7. [Bounded Contexts](03-bounded-contexts/) — one document per
   context, with its model, use cases, repositories, and events.
8. [Implementation Guide](04-implementation-guide/) — directory
   layout, layering, migration plan, testing.

## Document Index

### 01 — Strategic Design

- [Domain Vision Statement](01-strategic-design/domain-vision.md)
- [Ubiquitous Language](01-strategic-design/ubiquitous-language.md)
- [Subdomain Classification](01-strategic-design/subdomains.md)
- [Bounded Contexts](01-strategic-design/bounded-contexts.md)
- [Context Map](01-strategic-design/context-map.md)

### 02 — Tactical Design

- [Aggregates](02-tactical-design/aggregates.md)
- [Entities and Value Objects](02-tactical-design/entities-and-value-objects.md)
- [Domain Events](02-tactical-design/domain-events.md)
- [Domain Services](02-tactical-design/domain-services.md)
- [Repositories](02-tactical-design/repositories.md)
- [Application Services](02-tactical-design/application-services.md)

### 03 — Bounded Contexts

- [Workflow Orchestration](03-bounded-contexts/workflow-orchestration.md)
- [Human Interaction](03-bounded-contexts/human-interaction.md)
- [Identity & Access](03-bounded-contexts/identity-and-access.md)
- [UI Generation](03-bounded-contexts/ui-generation.md)
- [Notification & Realtime](03-bounded-contexts/notification-and-realtime.md)
- [Audit & Analytics](03-bounded-contexts/audit-and-analytics.md)

### 04 — Implementation Guide

- [Layered Architecture](04-implementation-guide/layered-architecture.md)
- [Directory Structure](04-implementation-guide/directory-structure.md)
- [Migration Plan from Legacy Code](04-implementation-guide/migration-plan.md)
- [Testing by Layer](04-implementation-guide/testing-by-layer.md)

## How This Maps to the Codebase

| DDD Concept       | Code Location                              |
| ----------------- | ------------------------------------------ |
| Bounded Context   | `src/backend/contexts/<context>/`          |
| Domain Layer      | `src/backend/contexts/<context>/domain/`   |
| Application Layer | `src/backend/contexts/<context>/application/` |
| Infrastructure    | `src/backend/contexts/<context>/infrastructure/` |
| Inbound Adapters  | `src/backend/contexts/<context>/interfaces/` |
| Shared Kernel     | `src/backend/shared-kernel/`               |
| Schemas           | `database/schemas/`                        |

See [docs/adr/](../adr/README.md) for the architectural decisions
that frame this design.
