# 0018. Monorepo and Module Structure

- **Status:** Accepted
- **Date:** 2025-10-26
- **Deciders:** Engineering Leads
- **Tags:** repo, structure

## Context

The platform contains multiple deliverables: the backend API, the
frontend SPA, infrastructure as code, database migrations, load
tests, and documentation. We need a single source of truth that:

- Lets backend and frontend evolve in lockstep when contracts change.
- Avoids dependency hell between published packages.
- Keeps CI fast and feedback tight.

## Decision

We will operate as a **monorepo** with a clear top-level structure:

```
GUI-LOP/
├── src/
│   ├── api/           # Public REST API entry (versioned routes)
│   ├── backend/       # Backend code organised by bounded context
│   └── frontend/      # React SPA
├── database/          # Schemas, migrations, seeds, scripts
├── infrastructure/    # IaC, Docker, K8s manifests
├── monitoring/        # Dashboards, alert rules
├── tests/             # Cross-cutting tests (load, integration, security)
├── docs/              # Documentation, ADRs, DDD
├── scripts/           # One-off utility scripts
└── examples/          # Sample integrations
```

Inside `src/backend/`, we organise by bounded context (DDD, ADR 0003)
rather than by technical layer at the top level:

```
src/backend/
├── shared-kernel/     # Cross-context value objects, base classes
├── contexts/
│   ├── workflow-orchestration/
│   │   ├── domain/
│   │   ├── application/
│   │   ├── infrastructure/
│   │   └── interfaces/
│   ├── human-interaction/
│   ├── identity-and-access/
│   ├── ui-generation/
│   ├── notification/
│   └── audit-and-analytics/
└── bootstrap/         # Composition root, DI wiring, server start
```

A future move to multi-package (e.g. `pnpm` workspaces) is allowed
when a context is reused outside this monorepo.

## Alternatives Considered

- **Polyrepo** — strong isolation, painful coordination across
  contracts. Rejected for the current team size.
- **Single flat `src/`** — current legacy state; lacks domain
  boundaries. Replaced by the contexts layout.

## Consequences

### Positive

- One PR can update the contract and all consumers.
- Shared tooling (lint, typecheck, format) configured once.
- The directory structure mirrors the bounded contexts.

### Negative / Trade-offs

- CI must be smart about running only affected jobs (path-based
  filtering or a tool like Nx/Turbo) to stay fast.
- Module boundaries inside one repo rely on lint enforcement
  (ADR 0004), not the package manager.

### Neutral

- The root directory is reserved for canonical configuration
  (`package.json`, `tsconfig.json`, `docker-compose*.yml`); working
  files go in subdirectories per project convention.

## Compliance and Verification

- `dependency-cruiser` (or equivalent) enforces inter-context
  boundaries.
- CI uses path filters to skip unaffected pipelines.

## References

- ADR 0003 — DDD
- ADR 0004 — Hexagonal Architecture
