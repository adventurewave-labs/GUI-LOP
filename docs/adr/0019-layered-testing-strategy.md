# 0019. Layered Testing Strategy

- **Status:** Accepted
- **Date:** 2025-10-26
- **Deciders:** QA Lead, Engineering Leads
- **Tags:** testing, quality

## Context

The system has multiple moving parts (Express, WebSocket, Redis,
Postgres, React) and several non-functional requirements (rate
limiting, auth, real-time delivery). A single test type cannot give
us the confidence we need at a tractable speed.

## Decision

We will follow a layered ("testing pyramid") strategy:

1. **Unit tests (Jest)** — domain and application code, no I/O. Fast,
   exhaustive on aggregates and value objects.
2. **Adapter contract tests (Jest + testcontainers)** — repositories,
   cache adapters, message bus adapters; both real and in-memory
   adapters must pass the same suite.
3. **Application service tests (Jest)** — wire use cases with in-
   memory adapters; cover happy paths and key failure modes.
4. **API tests (Jest + supertest)** — exercise HTTP endpoints with a
   real Express app and an in-memory or test-DB stack.
5. **Integration tests (Jest)** — real Postgres, real Redis (via
   docker-compose or testcontainers), exercising end-to-end
   workflows.
6. **E2E tests (Playwright)** — real browser, real backend, scripted
   user flows.
7. **Load tests (`tests/load/`)** — capacity and soak testing under
   target concurrency.
8. **Security tests (`tests/security/`)** — auth, JWT tampering,
   rate limit, injection.

Rules:

- Every public domain rule has a unit test.
- Every endpoint has at least one API test.
- Every cross-context flow with external visibility has an
  integration test.
- Coverage targets: >85% for `domain/`, >70% overall.
- Tests are colocated with the code under test where possible
  (`__tests__` next to the module) or under `tests/` for cross-
  cutting suites.
- No test creates files in the repo root.

## Alternatives Considered

- **Testing pyramid inverted (E2E heavy)** — slow, flaky; rejected.
- **No integration tests, mock everything** — fast but misses
  adapter bugs; rejected.

## Consequences

### Positive

- Fast feedback at the inner layers.
- Confidence at the outer layers.
- Adapter swaps (e.g. mock Redis) are validated by the same contract.

### Negative / Trade-offs

- More test types to maintain; we mitigate with shared fixtures and
  factories.
- Integration and E2E require infrastructure; provided by docker-
  compose for local and CI.

### Neutral

- Test data factories live in `tests/setup.js` and per-context
  helpers.

## Compliance and Verification

- Coverage is reported per layer and gated in CI.
- Flaky tests are quarantined and tracked; a flake budget is
  enforced.

## References

- `jest.config.js`, `jest.backend.config.js`
- `tests/` directory
