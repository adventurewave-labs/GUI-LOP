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
- **Where it lives.** `tests/contracts/<port>.spec.ts`. The same
  spec is parameterised across adapter implementations.

Why both: ensures the in-memory adapter is a faithful test double,
not a fiction. If the in-memory and Postgres adapters diverge,
the bug shows up here, not in production.

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
