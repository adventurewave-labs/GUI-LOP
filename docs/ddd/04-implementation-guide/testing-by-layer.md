# Testing by Layer

Each architectural layer has different test goals, dependencies, and
speed budgets. This document maps the testing strategy (ADR 0019) to
the layered architecture so it is unambiguous what a test "belongs"
where.

## Pyramid Mapped to the Hex

```
                     ┌──────────────┐
                     │   E2E (UI)   │   Playwright, slow, few
                     └──────────────┘
                  ┌────────────────────┐
                  │   System / Smoke   │   Real backend + DB + Redis
                  └────────────────────┘
              ┌──────────────────────────┐
              │  Integration (API)        │   Express + DB; supertest
              └──────────────────────────┘
          ┌──────────────────────────────────┐
          │  Adapter Contract Tests           │   Postgres / in-memory
          └──────────────────────────────────┘
      ┌──────────────────────────────────────────┐
      │  Application Service Tests                │   In-memory ports
      └──────────────────────────────────────────┘
  ┌──────────────────────────────────────────────────┐
  │  Domain Unit Tests (aggregates, VOs, services)    │   No I/O
  └──────────────────────────────────────────────────┘
```

## Domain Layer — Unit Tests

- **What.** Aggregates, value objects, domain services, FSMs.
- **How.** Pure constructors and methods, asserting state and
  emitted events. No mocks beyond ports passed by parameter
  (Clock, IdGenerator).
- **Speed budget.** Each test < 5 ms; whole layer suite < 5 s.
- **Coverage target.** > 90% for `domain/`.
- **Where it lives.** Co-located with the unit:
  `src/backend/contexts/<ctx>/domain/**/__tests__/*.test.ts`.

Example assertions:
- "An empty workflow cannot be `started`."
- "A `completed` workflow rejects further responses."
- "Recording a duplicate idempotency key returns the original
  response."

## Application Layer — Use Case Tests

- **What.** Commands and queries with in-memory adapters wired in.
- **How.** Build a use case with `InMemoryRepository`,
  `FrozenClock`, `DeterministicIdGenerator`, `InMemoryOutbox`. Run
  it, assert the resulting state, the events captured by the
  outbox, and the return value.
- **Speed budget.** < 50 ms each; suite < 30 s.
- **Coverage target.** Every use case has at least one happy-path
  test and tests for each domain-meaningful failure mode.
- **Where it lives.** Co-located with the use case:
  `src/backend/contexts/<ctx>/application/**/__tests__/*.test.ts`.

Forbidden in this layer:
- Network calls.
- Real DB or Redis.
- Express or WebSocket types.

## Adapter Contract Tests

- **What.** Repositories, cache adapters, outbox adapters, token
  issuers.
- **How.** A single contract suite per port runs against:
  - the in-memory adapter (used by application-layer tests),
  - the production adapter, under testcontainers (real Postgres /
    Redis).
- **Speed budget.** Per-suite under 1 minute; CI parallelises.
- **Coverage target.** Contract suites cover every method of every
  port and every documented edge case (concurrency, missing rows,
  TTL expiry).
- **Where it lives.** `tests/contracts/<context>/<port>.contract.test.js`.
  The same spec is parameterised across adapter implementations
  via `describe.each([['in-memory'], ['postgres']])`.

Why both: ensures the in-memory adapter is a faithful test double,
not a fiction. If the in-memory and Postgres adapters diverge,
the bug shows up here, not in production.

### Running the contract suite

The contract tests live behind their own Jest config because they're
slow (3-5 s container startup per file) and need a longer timeout:

```bash
# Local run — boots one Postgres 15 + one Redis 7 container per file.
npm run test:contracts

# Watch mode for iterative development.
npm run test:contracts:watch

# CI runs the suite informational/non-blocking via
# .github/workflows/contracts.yml.
```

#### Docker-availability auto-skip

Testcontainers requires a live Docker daemon. Many sandboxes (and
some CI agents) don't expose `/var/run/docker.sock`. To keep the suite
ergonomic in those environments, every contract `describe` block is
wrapped in `describeIfDocker(name, fn)` from
`tests/contracts/_helpers/docker-available.js`:

- If Docker **is** available (a socket at `/var/run/docker.sock` or an
  explicit `DOCKER_HOST` env var), the suite runs normally.
- If Docker is **not** available, the surrounding `describe` is
  replaced with `describe.skip(...)`, the block title is suffixed with
  `[skipped: docker unavailable]`, and a one-shot console notice is
  printed so the reason is visible in the log.

This means a Docker-less `npm run test:contracts` reports the suite as
"passed, all skipped" rather than failing on container start. CI has
Docker available, so the auto-skip never kicks in on GitHub Actions.

#### Fixture layout

- `tests/contracts/_helpers/docker-available.js` — `describeIfDocker`
  + `isDockerAvailable()`.
- `tests/contracts/_helpers/apply-migrations.js` — runs every file
  under `database/migrations/` against the testcontainer pool.
- `tests/contracts/_helpers/cleanup.js` — `truncateAll(pool)` between
  tests for isolation.
- `tests/contracts/_fixtures/postgres.js` — `startPostgres()` returns
  `{ pool, getPool, url, truncate, cleanup }`.
- `tests/contracts/_fixtures/redis.js` — `startRedis()` returns
  `{ client, pub, sub, getRedis, flush, cleanup }`.

## Integration / API Tests

- **What.** End-to-end through the application, including HTTP
  routing, request validation, auth middleware, real DB and Redis.
- **How.** Boot Express with the production composition root,
  pointed at testcontainers; use `supertest` to drive requests.
- **Speed budget.** Each test under 1 s; suite under 5 minutes.
- **Coverage target.** Every public endpoint has at least one
  happy-path test and one auth-failure test. Mutating endpoints
  also have an idempotency test.
- **Where it lives.** `tests/integration/` and
  `tests/api/`.

## End-to-End (UI) Tests

- **What.** Real browser, real backend, scripted user flows.
- **How.** Playwright spins up the app via `docker-compose` and
  drives the SPA.
- **Speed budget.** Each scenario < 30 s; suite < 15 min on CI.
- **Coverage target.** The handful of canonical flows (login,
  create workflow, approve human step, view dashboard).
- **Where it lives.** `src/frontend/tests/e2e/`.

## Load Tests

- **What.** Capacity, soak, and saturation behaviour.
- **How.** Custom node scripts under `tests/load/scenarios/`,
  driven by `tests/load/automated-load-test-suite.js`.
- **When.** Pre-release and on demand. Not gated on every PR.
- **Targets.** Per ADR 0021 SLOs: API p95, WebSocket delivery p99,
  outbox lag p95, login burst response.

## Security Tests

- **What.** Auth correctness, JWT tamper, rate limit, common
  injection vectors.
- **How.** Jest suites under `tests/security/` plus
  `npm run test:security` runner.
- **When.** On every PR.

## Property and Fuzz Tests (Optional but Encouraged)

- For aggregates with rich invariants (e.g. `Workflow` FSM), use
  property-based tests (`fast-check`) to assert "no sequence of
  legal operations leaves the workflow in an invalid state".
- For input validators (template parser, idempotency keys), use
  fuzz inputs to verify rejection or normalisation.

## Testing the Outbox Specifically

Because the outbox is central to event correctness, it gets
explicit chaos-style tests:

- Publisher crash mid-batch: events are still dispatched after
  restart, exactly the new batch.
- Subscriber failure: backoff and dead-letter routing work as
  configured.
- Replay: rebuilding a projection from `events` reproduces the
  current state.

These live in `tests/integration/outbox/`.

## Test Data and Fixtures

- Shared factories in `tests/setup.js` and per-context
  `__tests__/factories/`.
- Database fixtures applied via `database/seeds/` (seeds are
  idempotent).
- No production data ever reaches test or staging databases.

## Speed and Reliability Discipline

- A test that takes longer than its budget gets either reduced or
  promoted (e.g. integration → load).
- Flaky tests are quarantined into a tagged suite that does not
  gate merge but is reviewed weekly.
- Coverage is reported per layer; a regression in any layer fails
  CI.
