# 0002. Use Node.js and Express for Backend

- **Status:** Accepted
- **Date:** 2025-10-26
- **Deciders:** Backend team, CTO
- **Tags:** backend, runtime, framework

## Context

The platform needs an HTTP backend that can:

- Serve a REST API for workflow management.
- Host a long-lived WebSocket server for real-time UI updates.
- Integrate with external AI services (HTTP/SDKs).
- Run efficiently in containerised environments and on developer laptops.
- Use a language that the existing team is fluent in.

Workload is predominantly I/O bound (database, Redis, WebSocket fan-out,
external AI calls), with low CPU intensity per request.

## Decision

We will use Node.js (LTS, currently 18.x or higher) as the runtime and
Express 4.x as the HTTP framework, with native `http`/`ws` modules for the
WebSocket layer. ECMAScript modules (`"type": "module"`) are the default;
TypeScript is used at the `tsconfig.json` boundary for type checking.

## Alternatives Considered

- **Fastify** — faster routing, schema-first validation. Rejected for now
  because Express's ecosystem maturity and team familiarity outweighed the
  performance delta for our workload. Revisitable.
- **NestJS** — opinionated, DI-driven, TypeScript-first. Rejected because
  it pushes a class/decorator style that conflicts with our preference for
  explicit, function-oriented domain code.
- **Go (Gin/Fiber)** — excellent concurrency. Rejected because it would
  fragment the team's language stack and require duplicating shared types.
- **Python (FastAPI)** — strong AI ecosystem. Rejected because the bulk
  of orchestration logic is I/O coordination where Node.js excels.

## Consequences

### Positive

- Single language across backend and frontend simplifies hiring and
  shared tooling.
- The event-loop concurrency model maps naturally to WebSocket fan-out.
- Mature ecosystem (Jest, Express middleware, Playwright).

### Negative / Trade-offs

- CPU-bound work (e.g. PDF generation, heavy template rendering) must be
  offloaded to worker threads or external services.
- JavaScript's loose typing risks runtime errors; mitigated with
  TypeScript on shared types and rigorous integration tests.
- Express middleware chains can become opaque; we mitigate via the
  hexagonal architecture (see ADR 0004).

### Neutral

- Future modules can be authored in TypeScript without runtime changes;
  `tsc --noEmit` enforces typing in CI.

## Compliance and Verification

- `npm run typecheck` runs in CI on every PR.
- `package.json` pins `node >= 18.x` via `engines`.
- New backend modules must export a pure-function "use case" that is
  testable without Express.

## References

- Express 4.x documentation
- Node.js LTS release schedule
- ADR 0004 — Hexagonal Architecture
