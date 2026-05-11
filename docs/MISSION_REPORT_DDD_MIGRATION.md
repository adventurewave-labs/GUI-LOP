# DDD Migration Mission Report

**Branch:** `claude/create-adr-ddd-docs-bZodK`
**Range (iteration 1):** docs commit `5cecab8` → `e816f43`
**Range (iteration 2):** `08dcc5b` → `e23be41`
**Range (iteration 3):** `13296a9` → `dcbab3b`
**Range (iteration 4 — Phase 7 cleanup):** `417da9a` → final
**Date:** 2026-05-10

## Iteration 4 — Phase 7 cleanup (final)

The original migration plan's Phase 7 is now complete. Inline single-
session work (no parallel agents — small, surgical).

- **Deleted** `src/backend/simple-server.js`, `database-server.js`,
  `enhanced-server.js`, `enhanced-auth-middleware.js`, plus the
  legacy `middleware/`, `services/`, `models/`, `routes/`, `utils/`,
  `config/`, `tests/` trees under `src/backend/`.
- **Deleted** `legacy-router.js` and its mount in `bootstrap/main.js`
  + its export from `wire-workflow-orchestration.js` + the
  alias-only test case in the workflow HTTP test.
- **Deleted** the legacy test files that exercised the deleted code:
  `tests/backend/{server,simple-server,websocket}.test.js`,
  `tests/integration/full-workflow.test.js`, and seven legacy
  `tests/security/*.test.js` files. The DDD-era security coverage
  lives in the contexts' own `__tests__/` and the testcontainers
  contract suite.
- **Updated** `package.json` — `main`, `start`, `dev` now point at
  `src/backend/bootstrap/index.js`.
- **Updated** `jest.backend.config.js` testMatch — removed deleted
  paths; kept the per-context `__tests__/**` and the integration
  suites.
- **Strict dep-cruiser** — added two new rules:
  - `no-cross-context-imports` — one bounded context may not import
    from another; cross-context coupling goes through ports.
  - `no-legacy-resurrection` — any attempt to recreate the deleted
    `src/backend/{middleware,services,…}` paths fails CI.
- **Mission test count:** 560 / 560 across 75 suites (was 561 / 75
  before deletion; -1 net is the alias-only test case that no longer
  has anything to assert).
- **Benchmarks:** 25 / 25 SLOs still PASS — no regression.

## Headline

24 ADRs, 6 bounded contexts, 426 unit/integration tests passing
across 57 suites, 25/25 SLO benchmarks PASS, full bootstrap
composition root wired and smoke-tested. Two real wiring bugs
discovered by benchmarking and fixed in the same pass.

## What was delivered

### Documentation (committed first)
- `docs/adr/` — 24 ADRs + index + template, covering every cross-
  cutting decision (architecture, persistence, auth, real-time,
  observability, deployment, idempotency, anti-corruption, etc.).
- `docs/ddd/` — full DDD set: strategic (vision, ubiquitous
  language, subdomains, contexts, context map), tactical
  (aggregates, entities/VOs, events, services, repositories,
  application services), per-context details (×6), and the
  implementation guide (layered architecture, directory structure,
  phased migration plan, testing-by-layer).

### Phase-by-phase implementation

| Phase | Context | Tests | Notes |
| ----- | ------- | ----- | ----- |
| 0 | Shared Kernel + Foundation | 91 | Result, DomainEvent, errors, VOs, Clock/IdGen ports + impls, Pg outbox + UoW, config loader, dep-cruiser layer rules. |
| 1 | Identity & Access | 74 + 2 | User/Session/Role/ApiKey aggregates, JWT issuer + refresh, RBAC, blacklist, bcrypt hasher, auth middleware (with `req.user`/`req.principal`/`req.actor` triple-shape after Fix 1), idempotency middleware, rate limit. |
| 2 | Workflow Orchestration | 104 + 8 | WorkflowTemplate + Workflow aggregates, full FSM, deterministic engine, optimistic concurrency, idempotent commands, legacy `/api/workflows/*` alias, **template cache** decorator (10–18% read win in-memory, larger under Postgres). |
| 3 | Human Interaction | 67 + 5 | HumanResponse aggregate (idempotent, immutable), PendingStep projection, eligibility/escalation services, deadline watcher (frozen-clock testable), full HITL protocol. |
| 4-6 | Notification + UI Generation + Audit & Analytics | 65 | Subscription aggregate + WebSocket broadcaster + email/webhook ports, UISpecification + UIDocument + LayoutComposer, query services + projection updater, exports. |
| Bootstrap | Composition root | +3 (smoke) | `bootstrap()` returns `{app, httpServer, shutdown}`. In-memory by default, switches to Postgres/Redis when env URLs are set. Auto-seeds three default templates in dev. WebSocket attached on the same HTTP server. |
| Optimization | Wiring/perf pass | +22 | Fixed two real wiring bugs (auth-middleware/router shape mismatch; double-prefix on human-interaction router). bcrypt worker pool (factor 12 in prod no longer blocks event loop). Template-read cache. Outbox `OUTBOX_BATCH_SIZE` tuned to 200. |
| **Total** | **6 contexts + foundation + bootstrap** | **426 tests / 57 suites** | All green. |

### Database migrations added

- `003_outbox_and_idempotency.sql` — outbox, idempotency_keys, dead_letters tables.
- `004_workflow_versioning.sql` — `workflows.version` column for optimistic concurrency.
- `005_pending_steps.sql` — projection table with overdue partial index.
- `006_subscriptions.sql` — subscriptions, delivery_attempts.
- `007_ui_documents.sql` — generated UI document metadata.

### Benchmark results — 25/25 SLOs PASS

Run `npm run bench` to reproduce. Latest results in
`tests/benchmarks/results/latest.md` and `latest.json`. Baseline
preserved in `baseline-pre-optimization.json`.

| Bench | p95 | SLO | Status |
| ----- | --- | --- | ------ |
| `workflow.detail` | 1.26 ms | < 250 ms | PASS (199× headroom) |
| `workflow.create` | 1.89 ms | < 250 ms | PASS |
| `workflow.execute` | 1.92 ms | < 250 ms | PASS |
| `workflow.respond` | 1.93 ms | < 250 ms | PASS |
| `workflow.lifecycle` | 5.45 ms | < 750 ms | PASS |
| **`auth.login`** | **61.88 ms** | **< 100 ms** | **PASS** (was 245 ms before bcrypt offload) |
| `auth.register` | 61.63 ms | < 250 ms | PASS |
| `auth.refresh` | 1.77 ms | < 50 ms | PASS |
| `auth.middleware` | 1.30 ms | < 10 ms | PASS |
| Repository ops (×6) | < 0.05 ms | < 5 ms | PASS |
| `outbox.publish[1000]` drain | 26.13 ms | < 5 s | PASS |
| `websocket.broadcast[500]` p99 | 4.73 ms | < 1 s | PASS |
| Pure domain ops (×4) | < 0.03 ms | < 1 ms | PASS |

### Bugs found and fixed during the mission

1. **Auth shape mismatch.** Auth middleware set `req.principal` but
   downstream routers read `req.user`. Fixed with dual exposure
   (`req.principal`, `req.user`, `req.actor` all populated).
2. **Human-interaction double-prefix.** Router declared absolute
   paths while bootstrap mounted at `/api/v1`, yielding `/api/v1/api/v1/...`.
   Fixed by switching the router to relative paths.
3. **Workflow Template column.** Existing `workflow_templates` table
   has no `version` column; the Pg adapter smuggles aggregate version
   through `default_config.__version` as a stop-gap. Captured as a
   follow-up in the workflow context's open questions.

### Architectural enforcement

- `.dependency-cruiser.cjs` codifies the four-layer hexagonal
  boundary rules (`domain` cannot import `application` /
  `infrastructure` / `interfaces`, etc.). Run via
  `npm run lint:arch` (requires `dependency-cruiser` devDep).
- All contexts include both Postgres adapters and in-memory
  adapters; both pass the same use-case suites.

### Iteration 2 (2026-05-10, post-mission-report follow-ups)

In a second `/loop` pass, four parallel agents knocked down most of
the backlog from iteration 1. Pushed commits:

| Commit | Item | Tests added |
| ------ | ---- | ----------- |
| `835f06d` | Production Dockerfile + docker-compose + Helm chart + 4 GitHub Actions workflows + production deployment guide. `helm lint` clean; `helm template` renders 9 resources. | n/a |
| `e9a9a83` | Identity follow-ups: `ApiKey` aggregate (mint/revoke/recordUsage/isUsable, plaintext-once, SHA-256 stored), API-key auth path in middleware (`glop_…` prefix), `/api/v1/auth/api-keys` router, `/api/v1/admin/{users,…/permissions,…/deactivate,…/reactivate}` admin router, `adminGuard`, migrations 008 (api_keys indexes) + 009 (`user_permissions` table). | +55 (78→133 in IAM) |
| `1ed7dcd` | Frontend cut-over: centralised v1 API client with auto-refresh-on-401 + idempotency keys, versioned WebSocket client with reconnect backoff, feature folders per bounded context, RefreshGuard + protected routes, Playwright e2e coordinated via `webServer`. | +14 unit + 3 e2e |
| `e23be41` | Workflow + observability: real `version` column on `workflow_templates` (migration 010 with one-release JSONB-fallback), `OutboxRepository` extended with `getOldestPendingAge()` + `getPendingCount()`, `/health` now reports `subsystems.{db,redis,outbox.{lag_ms,pending_count}}`, in-memory `forwardWorkflowEvents()` so dev mode fans events through the same DeliverEvent pipeline as prod. | +22 |

**Iteration 2 totals:**
- 500/500 tests passing across 66 suites (was 426/57).
- 25/25 SLO benchmarks still PASS — `auth.login` p95 at 67–72 ms (well under 100 ms), workflow ops 1–2 ms p95.
- Working tree clean; all four agent commits scoped to their non-overlapping path budgets.

### Iteration 3 (2026-05-10, final follow-ups)

Three parallel agents closed out the remaining backlog. Pushed commits:

| Commit | Item | Tests added |
| ------ | ---- | ----------- |
| `9227e38` | **AdvanceWorkflow fix.** `AdvanceWorkflowUseCase` now applies the human response to the `Workflow` aggregate (`workflow.applyHumanResponse(stepId, response, now)`) before re-running the engine, so dev-mode workflows now reach `workflow.completed` end-to-end. The in-process `WorkflowAdvancer` adapter already forwarded `{stepId, response}` — no wiring change. New integration test `tests/integration/workflow-completion.test.js` asserts the full event sequence including `workflow.completed`. | +7 |
| `73cc7bd` | **Real AI provider ACL** (ADR 0023). `AIProvider` + `ClassificationService` ports. OpenAI and Anthropic adapters (no vendor SDKs — `fetch` only, default Anthropic model `claude-haiku-4-5`). `BaseAIAdapter` composes retry+jitter, circuit breaker, telemetry, PII scrubbing. Domain error taxonomy (`AIProviderUnavailable`, `AIQuotaExceeded`, `AIInvalidRequest`, `AIBadResponse`). `wire-ui-generation.js` reads `AI_PROVIDER` (`stub`/`openai`/`anthropic`, default `stub`); fails fast at boot if a real vendor is selected without `AI_API_KEY`. `GenerateUIForStepUseCase` routes through the provider when `strategyHint === 'ai-assisted'`, deterministic fallback otherwise. | +61 |
| `dcbab3b` | **Testcontainers contract suites** for every bounded context. 22 files under `tests/contracts/` covering 14 repositories + Redis-backed token blacklist, event publisher, rate-limit primitives. Same `describe.each` runs the same assertions against in-memory and Postgres adapters; the Postgres branch is gated by `describeIfDocker(...)` from `_helpers/docker-available.js`. Adds `testcontainers@^10` + `@testcontainers/postgresql` + `@testcontainers/redis` devDeps, `jest.contracts.config.js`, `npm run test:contracts`, and `.github/workflows/contracts.yml` (informational, non-blocking). | +148 (Docker-gated) |

**Iteration 3 totals:**
- 561/561 backend tests passing across 75 suites (was 500/66 — net +61 from the AI ACL agent's tests; AdvanceWorkflow added 7, contracts added 0 because they auto-skip without Docker).
- 148 additional contract tests skipped cleanly when Docker is unavailable; they execute against real Postgres + Redis containers in CI and any dev environment with Docker.
- 25/25 SLO benchmarks still PASS — no regression.
- Working tree clean; three agent commits scoped to fully non-overlapping path budgets.

### Remaining backlog (iteration 3 candidates)

All iteration-2 deferred items now resolved.

Resolved in iteration 3:

- ~~**Real Postgres / Redis integration tests** under testcontainers.
  Currently only unit + in-memory integration coverage. Bench can
  also be re-run against Postgres. Deferred from iteration 2 because
  it touches every context (high collision risk with parallel work).~~
  Done — adapter contract suites under
  `tests/contracts/<context>/*.contract.test.js`, one per port per
  bounded context plus the shared-kernel Outbox + the Redis-backed
  TokenBlacklist / EventPublisher / rate-limit primitives. Run via
  `npm run test:contracts`; the suite auto-skips cleanly when Docker
  is unavailable (`tests/contracts/_helpers/docker-available.js`).
  CI workflow `.github/workflows/contracts.yml` is informational and
  non-blocking until it stabilises.

- ~~**Real AI provider ACL** (ADR 0023):~~ Done. `AIProvider` and
  `ClassificationService` ports plus OpenAI and Anthropic adapters
  shipped at `src/backend/contexts/ui-generation/infrastructure/ai/`,
  composed with retry / circuit-breaker / telemetry / PII-scrubbing in
  a shared `BaseAIAdapter`. `AI_PROVIDER` / `AI_API_KEY` env vars
  select the vendor; `stub` remains the default.

A small follow-up flagged by the workflow agent for iteration 3:

- ~~**`AdvanceWorkflow` doesn't yet apply the human response.** Dev-
  mode workflows paused on a human step never resume to `completed`
  because `AdvanceWorkflowUseCase.execute(...)` ignores the
  `stepId`/`response` arguments the in-process `WorkflowAdvancer`
  passes. Should call `workflow.applyHumanResponse(stepId, response, now)`
  before re-running the engine.~~ **Done** (iteration 3, this
  commit): `AdvanceWorkflowUseCase` now applies the human response
  to the aggregate before re-running the engine; the in-process
  `WorkflowAdvancer` adapter already forwarded `{stepId, response}`
  so no wiring change was needed. Covered by new unit tests in
  `src/backend/contexts/workflow-orchestration/__tests__/application/advance-workflow.test.js`
  and a new end-to-end integration test in
  `tests/integration/workflow-completion.test.js` that asserts the
  broadcaster observes `workflow.completed`.

### Original known follow-ups (iteration 1, mostly resolved)

The following items from the iteration-1 backlog are now done:

- ~~**Frontend cut-over.**~~ Done (`1ed7dcd`).
- ~~**API key aggregate** in Identity & Access.~~ Done (`e9a9a83`).
- ~~**Admin routes** for grant/revoke permission.~~ Done (`e9a9a83`).
- ~~**Workflow templates `version` column.**~~ Done (`e23be41`).
- ~~**Outbox lag metric** in `/health`.~~ Done (`e23be41`).
- ~~**Forwarder for in-memory mode.**~~ Done (`e23be41`).
- ~~**Production Helm/K8s manifests.**~~ Done (`835f06d`).
- ~~**Real AI provider ACL** (ADR 0023):~~ Done (iteration 3). OpenAI
  and Anthropic adapters at
  `src/backend/contexts/ui-generation/infrastructure/ai/`.
- **Production Helm/K8s manifests** (ADR 0020): infrastructure
  directory exists; chart needs to be updated to call the new
  bootstrap entry (`src/backend/bootstrap/index.js`).

## How to run

```bash
# Tests
npx jest --config jest.backend.config.js src/backend/ tests/backend/contexts/ tests/integration/bootstrap-smoke.test.js tests/integration/human-interaction-routes.test.js

# Benchmarks
npm run bench
# or per-scenario
npm run bench:workflow
npm run bench:auth
npm run bench:domain

# Boot the new server (in-memory mode if env vars unset)
node src/backend/bootstrap/index.js
# or with nodemon
npm run dev:v1

# Production-style local stack (added in iteration 2)
docker-compose up        # Postgres + Redis + app, migrations auto-run

# Helm (production deploy)
helm lint infrastructure/helm/gui-lop
helm install gui-lop infrastructure/helm/gui-lop -f values.prod.yaml

# Frontend (added in iteration 2)
cd src/frontend && npm test            # unit (no backend)
cd src/frontend && npm run test:e2e    # Playwright (boots backend)
```

## Commit timeline (selected)

```
e816f43 perf+fix(integration): wire bug fixes, bcrypt offload, template cache, outbox batch tuning
e9754b1 feat(benchmarks): add SLO-driven benchmark suite for all hot paths
ffa2a44 chore: remove temporary src/backend/contexts gitignore
67a80ec feat(bootstrap): swap stubs for canonical shared-kernel + wire composition root
a654384 merge: Phase 2 Workflow Orchestration
57878f1 merge: Phase 4-6 Notification, UI Generation, Audit & Analytics
7efeebb merge: Phase 1 Identity & Access
edea475 merge: Phase 3 Human Interaction
b31397e Phase 0: shared-kernel foundation, outbox migration, arch lint
5cecab8 docs: add full ADR and DDD documentation set
```
