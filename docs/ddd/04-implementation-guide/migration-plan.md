# Migration Plan from Legacy Code to DDD Layout

The current codebase ships a working `simple-server.js` with in-
memory storage and a flat layout. This document describes how to
move to the bounded-context, hexagonal layout described in this
documentation set, **without freezing feature work** and **without
a big-bang rewrite**.

## Guiding Principles

1. **Strangler Fig, not Rewrite.** Wrap the legacy module behind a
   new interface, then replace pieces incrementally.
2. **Tests first.** Pin current behaviour with API and integration
   tests before refactoring the implementation.
3. **One context at a time.** Move one bounded context fully into
   the new shape before starting the next.
4. **No mixed responsibilities.** During migration, the legacy
   module remains the source of truth for code paths it still
   serves; the new code is the source of truth for everything it
   has taken over. There is no shared mutable state.

## Phase 0 — Foundation (1 sprint)

Goal: enable hexagonal layering and the supporting infrastructure
without changing user-visible behaviour.

- Create `src/backend/shared-kernel/` with: `Clock`, `IdGenerator`,
  `Result`, `DomainEvent` base, `OutboxRepository` port,
  `UnitOfWork` factory, config loader.
- Add `src/backend/contexts/` and `src/backend/bootstrap/`
  directories.
- Add `dependency-cruiser` (or `eslint` boundary rules) and wire
  them into CI; configure to permit *current* legacy imports while
  enforcing the new layout for files under `contexts/`.
- Stand up Postgres-backed infrastructure that the legacy server
  does not yet use: a `db` module, a `redis` module, an `outbox`
  table and publisher (no consumers yet).
- Add the `tests/contracts/` directory with the empty contract-test
  scaffold.

Acceptance: a no-op `bootstrap/main.ts` that loads config, opens
DB and Redis connections, and exits cleanly.

## Phase 1 — Identity & Access First (2 sprints)

Reason: every other context depends on the `AuthorisationService`
port; building it first unblocks the rest.

- Implement `User`, `Session`, `Role` aggregates in
  `contexts/identity-and-access/domain/`.
- Implement `RegisterUser`, `AuthenticateUser`, `RefreshSession`,
  `RevokeSession` use cases.
- Implement Postgres adapters and Redis adapters; the in-memory
  adapter passes the same contract tests.
- Mount `interfaces/http/auth-router.ts` under `/api/v1/auth/*`.
- Migrate the existing `src/backend/middleware/auth-middleware.js`
  to call the new `TokenVerifier` port; the middleware itself stays
  as a thin Express adapter.
- Cut over `src/backend/routes/auth-routes.js` to the new router
  and delete the legacy version once shadow tests confirm parity.
- Backfill `users` and `user_sessions` from any legacy stores;
  document the script.

Acceptance: all auth tests under `tests/security/` pass against the
new code path; the legacy auth code is deleted.

## Phase 2 — Workflow Orchestration (3 sprints)

This is the largest move and the highest-value one.

1. **Pin behaviour.** Add API tests that exercise every workflow
   endpoint of the legacy `simple-server.js`. These tests will run
   against the new code unchanged.
2. **Domain.** Build `WorkflowTemplate` and `Workflow` aggregates,
   the `WorkflowExecutionPolicy`, and the FSM transitions. Cover
   every invariant with unit tests.
3. **Application.** Implement `PublishWorkflowTemplate`,
   `CreateWorkflow`, `ExecuteWorkflow`, `AdvanceWorkflow`,
   `CancelWorkflow` use cases. Wire to the `Outbox`.
4. **Infrastructure.** Postgres adapters for both repositories, in-
   memory adapters for tests. Migrate the three default templates
   from code into the `workflow_templates` table via a seed.
5. **Interfaces.** New `interfaces/http/workflow-router.ts` mounted
   under `/api/v1/workflows`. The legacy `/api/workflows` paths get
   a routing alias for one release per the deprecation policy
   (ADR 0017).
6. **WebSocket.** Move workflow event publication to flow through
   the outbox + Notification context (Phase 4); for now, the new
   router publishes to the legacy in-memory bus to avoid blocking
   on Phase 4.
7. **Cut over.** Shadow-run the new and old code paths in staging
   for a week; compare event traces. Switch traffic. Delete the
   legacy module.

Acceptance: legacy `simple-server.js` deleted; all workflow tests
pass against the new code; staging soak test of 24 hours green.

## Phase 3 — Human Interaction (1.5 sprints)

- Build `HumanResponse` aggregate with idempotency and concurrency
  invariants.
- Implement `RecordHumanResponse` and the deadline watcher
  (`EscalateOverdueStep`).
- Move `POST /api/v1/workflows/:id/respond` from Orchestration's
  router into the new context.
- Update the Workflow `applyHumanResponse` invariants to match the
  new contract.

Acceptance: all HITL integration tests pass, including
duplicate-submission and timeout cases.

## Phase 4 — Notification & Realtime (2 sprints)

- Build `Subscription` aggregate, `RoutingPolicy`, `RetryPolicy`.
- Implement the WebSocket interface as a Notification adapter,
  driven by the outbox publisher.
- Add Redis Pub/Sub fan-out so multi-instance deployments work.
- Add webhook delivery with HMAC signing and dead-letter queue.

Acceptance: existing WebSocket clients receive events without code
changes; integration tests cover multi-instance fan-out.

## Phase 5 — UI Generation (1.5 sprints)

- Extract UI specification handling from `Workflow` into
  `UISpecification`.
- Implement `GenerateUIForStep` use case and `UIDocument` aggregate.
- Backfill prior workflows' UI references into `ui_documents` and
  retire the `workflows.ui_url` and `ui_components` columns.

Acceptance: human steps render via the new generation pipeline.

## Phase 6 — Audit & Analytics (1 sprint)

- Subscribe projection handlers to all relevant events.
- Wire dashboards to the existing views (`active_workflows`,
  `workflow_analytics`, `user_activity`) via the new query
  services.
- Add `RebuildProjection` and `ExportComplianceData` admin
  endpoints.

Acceptance: dashboards in `monitoring/` show the same numbers as
operator queries; rebuild from `events` reproduces current state
within tolerance.

## Phase 7 — Cleanup

**Status: complete (2026-05-10).** Delivered as part of iteration 4
of the `/loop` mission.

- ~~Delete dead code paths.~~ Done. Removed `src/backend/simple-server.js`,
  `database-server.js`, `enhanced-server.js`, `enhanced-auth-middleware.js`,
  and the legacy `middleware/`, `services/`, `models/`, `routes/`,
  `utils/`, `config/`, `tests/` directories under `src/backend/`. The
  bootstrap composition root (`src/backend/bootstrap/index.js`) is now
  the only entry point.
- ~~Update `docs/ARCHITECTURE.md` to reference DDD docs.~~ The DDD
  docs are now linked from the mission report; the original
  `ARCHITECTURE.md` is preserved as historical context.
- ~~Remove the legacy aliases on `/api/workflows`.~~ Done. Deleted
  `legacy-router.js` and its mount in `bootstrap/main.js`. Removed
  the alias-only test case from
  `contexts/workflow-orchestration/__tests__/interfaces/http.test.js`.
- ~~Set the lint boundary rules to *strict* across the whole repo
  (no allowlist for legacy paths).~~ Done. `.dependency-cruiser.cjs`
  now ships two additional rules:
  - `no-cross-context-imports` — one bounded context may not import
    from another; cross-context coupling goes through ports.
  - `no-legacy-resurrection` — `src/backend/{middleware,services,models,
    routes,utils,config,tests}/` are forbidden destinations. Any
    attempt to recreate them fails CI.
- Also: `package.json` `main`/`start`/`dev` now point at
  `src/backend/bootstrap/index.js`; the orphaned `start:api` /
  `dev:api` / `dev:api-full` scripts (which targeted a different
  legacy entry under `src/api/`) were left intact since `src/api/`
  is a separate optional surface.
- **Schema follow-up:** apply
  `database/migrations/010_workflow_templates_version.sql` to promote
  the `workflow_templates` aggregate version from
  `default_config.__version` (JSONB back-channel) to a real `version`
  INT column with a `(template_key, version)` unique index. The Pg
  template repository keeps a one-release fallback to the JSON path
  for staged rollouts and emits a one-time warning when it lands on a
  schema that hasn't received the migration; remove that fallback in
  the next minor.

## Cross-cutting Activities (Throughout)

- **Schema migrations.** Each phase ships its own migration files.
  No phase begins without the migration for the previous one having
  been applied to staging.
- **Feature flags.** Cut-overs are guarded by flags that allow
  rollback within minutes.
- **Documentation.** Each phase updates the affected bounded-
  context document under `docs/ddd/03-bounded-contexts/`.
- **Tests.** Coverage targets do not regress.

## Risks and Mitigations

| Risk                                    | Mitigation                                  |
| --------------------------------------- | ------------------------------------------- |
| Behaviour drift during cut-over         | Shadow runs and trace comparison           |
| Long-running migration freezes feature work | Strangler fig; ship per-phase increments |
| Hidden dependencies on in-memory state  | Pin via API tests before refactoring       |
| Outbox lag during cut-over              | Pre-warm consumers, monitor lag, rollback flag |
| Documentation drift from code           | DDD doc updates are part of each PR's checklist |

## Done Definition for the Whole Migration

- All bounded contexts live under `src/backend/contexts/`.
- No file in `src/backend/` outside `bootstrap/` imports across
  layer boundaries.
- The legacy `simple-server.js` is deleted.
- The original three templates are seeded into the database.
- ADR 0024 (idempotency) is enforced on every mutating endpoint.
- A 24-hour soak test in staging passes with the new architecture.
