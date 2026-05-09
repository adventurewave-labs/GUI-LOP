# Layered Architecture

This document codifies the layering convention used inside every
bounded context. It is the implementation form of the hexagonal
(ports and adapters) architecture chosen in [ADR 0004](../../adr/0004-hexagonal-architecture.md).

## The Four Layers

```
┌──────────────────────────────────────────────────────────────┐
│ interfaces  (inbound adapters: HTTP, WebSocket, CLI, jobs)   │
├──────────────────────────────────────────────────────────────┤
│ infrastructure (outbound adapters: Postgres, Redis, AI, mail)│
├──────────────────────────────────────────────────────────────┤
│ application  (use cases, ports, application services)        │
├──────────────────────────────────────────────────────────────┤
│ domain       (entities, VOs, aggregates, domain services,    │
│               domain events, invariants)                     │
└──────────────────────────────────────────────────────────────┘
```

Imports flow inward only. The compiled allowed-imports table:

| From          | May import                           | Must NOT import                |
| ------------- | ------------------------------------ | ------------------------------ |
| domain        | shared-kernel                        | application, infrastructure, interfaces |
| application   | domain, shared-kernel                | infrastructure, interfaces     |
| infrastructure| domain, application, shared-kernel   | interfaces                     |
| interfaces    | application, domain, shared-kernel   | infrastructure (except for DI wiring at the composition root) |

## Layer Responsibilities

### Domain (`domain/`)

- The business model: aggregates, entities, value objects, domain
  services, domain events.
- Pure: no `await fetch`, no `pg`, no `express`, no environment
  variables, no clock reads (use the `Clock` port).
- 100%-unit-testable. Every invariant has a test.

### Application (`application/`)

- Use cases (commands), queries, application services, ports.
- Orchestrates domain types: load, mutate, save, emit.
- Owns transactions via the `UnitOfWork` factory.
- Receives all dependencies via the constructor (no global
  imports of infrastructure).

Subdivisions:

- `application/commands/` — one file per command use case.
- `application/queries/` — one file per query.
- `application/ports/` — interfaces for outward dependencies
  (repositories, clock, ids, hashers, AI clients).

### Infrastructure (`infrastructure/`)

- Concrete implementations of ports declared in `application/`:
  Postgres repositories, Redis caches, JWT verifiers, AI provider
  adapters, email senders.
- Knows the gory details (SQL, library specifics) and hides them.
- Owns the wire/storage shapes; provides mappers to/from domain
  types.

Subdivisions:

- `infrastructure/persistence/` — Postgres repos and migrations
  hooks.
- `infrastructure/cache/` — Redis adapters.
- `infrastructure/ai/<vendor>/` — AI provider ACLs (ADR 0023).
- `infrastructure/messaging/` — outbox publisher, pub/sub.

### Interfaces (`interfaces/`)

- Inbound adapters that translate transport calls into use-case
  calls.
- Subdivisions:
  - `interfaces/http/` — Express routers and request validators.
  - `interfaces/websocket/` — WebSocket message handlers.
  - `interfaces/jobs/` — scheduled jobs, watchers.
  - `interfaces/cli/` — admin scripts.

## Composition Root

A single module per process (`src/backend/bootstrap/`) wires
infrastructure adapters to application ports and starts the
inbound adapters. This is the only place where layers cross
freely. Every other module declares its dependencies as
constructor parameters.

```ts
// bootstrap/main.ts (sketch)
const config = loadConfig(process.env);
const db = createPgPool(config.db);
const redis = createRedis(config.redis);

const userRepo = new PgUserRepository(db);
const sessionRepo = new PgSessionRepository(db);
const outbox = new PgOutboxRepository(db);
const tokens = new JwtTokenIssuer(config.jwt);
const hasher = new BcryptPasswordHasher(config.bcrypt);

const authenticateUser = new AuthenticateUserUseCase(
  userRepo, sessionRepo, hasher, tokens, outbox, uow, clock, ids,
);

mountAuthRoutes(app, { authenticateUser, /* ... */ });
mountWebSocket(server, { /* ... */ });
startOutboxPublisher({ outbox, redis, /* ... */ });
```

## Cross-Context Calls

When context A needs context B's behaviour:

- A declares a port in its `application/ports/`, named after the
  capability it needs (e.g. `AuthorisationService`).
- B provides an in-process implementation of that port at the
  composition root.
- A never imports B's domain or infrastructure types.

This makes future extraction (B becomes a microservice) a
mechanical change: replace the in-process adapter with an HTTP/
gRPC client.

## Enforcement

- `dependency-cruiser` rules per layer (or `eslint-plugin-import`
  with custom resolver) reject violating imports at CI time.
- Code review checks for layering smells: SQL in domain code,
  Express types in application code, raw rows leaking out of
  repositories.

## Testing per Layer

See [testing-by-layer.md](testing-by-layer.md).
