# Directory Structure

The target directory layout aligns the codebase with bounded
contexts and the four-layer hexagonal architecture.

## Top Level

```
GUI-LOP/
├── src/
│   ├── api/                # HTTP API entry (versioned routers)
│   ├── backend/            # Bounded contexts + bootstrap
│   └── frontend/           # React SPA
├── database/
│   ├── schemas/            # Canonical SQL schema
│   ├── migrations/         # Versioned forward migrations
│   ├── seeds/
│   └── scripts/            # Backup, restore, ops scripts
├── docker/
├── infrastructure/         # IaC, K8s manifests, Helm
├── monitoring/             # Dashboards, alerts as code
├── tests/                  # Cross-cutting tests
├── scripts/                # One-off utilities
├── examples/               # Reference integrations
├── docs/                   # Documentation, ADRs, DDD
├── package.json
├── tsconfig.json
├── docker-compose*.yml
└── README.md
```

The repository root holds canonical configuration only. Working
files, test fixtures, and notes go into subdirectories per project
convention.

## Backend (`src/backend/`)

```
src/backend/
├── shared-kernel/
│   ├── domain/             # Cross-context VOs and base types
│   ├── ports/              # Clock, IdGenerator, Outbox
│   ├── infrastructure/     # System Clock, UUID generator
│   └── config/             # Schema-validated config loader
│
├── contexts/
│   ├── workflow-orchestration/
│   │   ├── domain/
│   │   │   ├── workflow/
│   │   │   │   ├── workflow.ts
│   │   │   │   ├── workflow-step.ts
│   │   │   │   ├── workflow-status.ts
│   │   │   │   ├── workflow-execution-policy.ts
│   │   │   │   └── events.ts
│   │   │   ├── template/
│   │   │   │   ├── workflow-template.ts
│   │   │   │   ├── step-definition.ts
│   │   │   │   └── events.ts
│   │   │   └── errors.ts
│   │   ├── application/
│   │   │   ├── commands/
│   │   │   │   ├── create-workflow.ts
│   │   │   │   ├── execute-workflow.ts
│   │   │   │   ├── advance-workflow.ts
│   │   │   │   ├── cancel-workflow.ts
│   │   │   │   └── publish-template.ts
│   │   │   ├── queries/
│   │   │   │   ├── get-workflow-detail.ts
│   │   │   │   ├── list-active-workflows.ts
│   │   │   │   └── list-templates.ts
│   │   │   └── ports/
│   │   │       ├── workflow-repository.ts
│   │   │       ├── template-repository.ts
│   │   │       ├── ui-generation-service.ts
│   │   │       └── authorisation-service.ts
│   │   ├── infrastructure/
│   │   │   └── persistence/
│   │   │       ├── pg-workflow-repository.ts
│   │   │       ├── pg-template-repository.ts
│   │   │       └── inmemory-workflow-repository.ts
│   │   └── interfaces/
│   │       ├── http/
│   │       │   ├── workflow-router.ts
│   │       │   └── template-router.ts
│   │       └── websocket/
│   │           └── workflow-events.ts
│   │
│   ├── human-interaction/
│   │   └── (same shape)
│   ├── identity-and-access/
│   ├── ui-generation/
│   ├── notification/
│   └── audit-and-analytics/
│
└── bootstrap/
    ├── config.ts
    ├── di-workflow.ts
    ├── di-identity.ts
    ├── di-…
    ├── http-server.ts
    ├── ws-server.ts
    ├── outbox-publisher.ts
    └── main.ts
```

## Frontend (`src/frontend/`)

```
src/frontend/
├── public/
├── src/
│   ├── App.jsx
│   ├── index.js
│   ├── routes/             # Route components
│   ├── features/           # Feature folders aligning to contexts
│   │   ├── workflows/
│   │   ├── inbox/
│   │   ├── auth/
│   │   └── admin/
│   ├── components/         # Generic, reusable UI primitives
│   ├── services/
│   │   ├── api/            # REST client, per-context adapters
│   │   └── websocket/
│   ├── state/              # Cross-feature stores (auth, prefs)
│   ├── hooks/
│   └── utils/
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/                # Playwright
└── package.json
```

## Tests (`tests/`)

```
tests/
├── api/
├── backend/                # Cross-context unit suites
├── integration/
├── load/
│   ├── automated-load-test-suite.js
│   └── scenarios/
├── security/
└── setup.js
```

Note that **per-context unit tests live next to the code** under
`src/backend/contexts/<ctx>/...`. The top-level `tests/` directory
is for cross-cutting suites (load, security, integration that
spans contexts).

## Database (`database/`)

```
database/
├── schemas/
│   └── 01_main_schema.sql
├── migrations/
│   ├── 001_initial_migration.sql
│   ├── 002_performance_optimization_migration.sql
│   └── migrate.js
├── seeds/
├── scripts/                # backup, restore, restore-verify
├── benchmarks/
├── monitoring/
└── utils/
```

Schemas are organised by area as the project grows
(`02_workflow_schema.sql`, `03_identity_schema.sql`, …) to keep
files readable.

## Documentation (`docs/`)

```
docs/
├── ARCHITECTURE.md
├── adr/                    # Architecture decision records
└── ddd/
    ├── 01-strategic-design/
    ├── 02-tactical-design/
    ├── 03-bounded-contexts/
    └── 04-implementation-guide/
```

## Naming Conventions

- Files: `kebab-case.ts`.
- Classes: `PascalCase`.
- Functions and variables: `camelCase`.
- Type aliases and interfaces: `PascalCase`, no `I-` prefix.
- One exported aggregate per file; supporting types in the same
  file are fine if small, otherwise split.
- Test files: alongside the unit under test, `<unit>.test.ts` or
  inside `__tests__/` subfolders.
- Migration files: `NNN_short_description.sql` with monotonically
  increasing `NNN`.

## What Stays at the Root

Only canonical configuration:

- `package.json`, `package-lock.json`
- `tsconfig.json`, `.babelrc`
- `jest.config.js`, `jest.backend.config.js`
- `docker-compose*.yml`
- `.env.example`, `.gitignore`
- `README.md`, `LICENSE`

Everything else lives in a subdirectory.
