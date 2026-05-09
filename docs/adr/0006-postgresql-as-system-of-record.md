# 0006. PostgreSQL as Primary System of Record

- **Status:** Accepted
- **Date:** 2025-10-26
- **Deciders:** Backend team, Data team
- **Tags:** persistence, database, postgres

## Context

The current `simple-server.js` keeps workflows in an in-memory `Map`.
That is acceptable for a demo but unacceptable for production:

- Process restarts lose all state.
- Horizontal scaling is impossible without a shared store.
- Audit/compliance requires durable, queryable history.
- Workflows can run for minutes to days while they wait for human input.

We need a transactional, queryable, durable store with strong support
for JSON (workflow context, step input/output), enforceable schemas,
and rich indexing.

## Decision

We will use PostgreSQL 13+ as the primary system of record for all
durable state, including users, sessions, workflows, workflow steps,
human responses, events, and audit logs. The schema is defined in
`database/schemas/01_main_schema.sql`.

Key conventions:

- UUIDs (`uuid_generate_v4()`) as primary keys.
- `JSONB` columns for context, configuration, and step payloads, with
  GIN indexes where queried.
- ENUM types for finite state machines (`workflow_status`,
  `event_type`).
- `created_at` / `updated_at` columns on every table, with `updated_at`
  maintained by a trigger.
- Append-only `events` and `audit_logs` tables (ADR 0016).
- Migrations under `database/migrations/`, applied with
  `npm run db:migrate`.

## Alternatives Considered

- **MongoDB** — flexible documents but weaker transactional guarantees
  for multi-aggregate updates and weaker join support. Rejected.
- **MySQL** — viable; rejected due to weaker JSONB support, less
  capable EXPLAIN, and weaker LISTEN/NOTIFY ecosystem.
- **DynamoDB / single-table NoSQL** — operationally lean on AWS but
  hostile to ad-hoc analytics and complex relational queries we expect.
- **SQLite for dev, Postgres for prod** — rejected because subtle
  behaviour differences (locking, JSON semantics) cause bugs to escape
  developer testing.

## Consequences

### Positive

- Strong consistency for all aggregate writes.
- Rich querying and analytics directly on the operational store
  (with read replicas, ADR 0021).
- `JSONB` lets us evolve workflow context without schema churn.

### Negative / Trade-offs

- Operational complexity: backups, vacuums, replication, failover.
- Long-running, unbounded workflows can accumulate large JSONB blobs;
  policy in
  [docs/ddd/03-bounded-contexts/audit-and-analytics.md](../ddd/03-bounded-contexts/audit-and-analytics.md)
  defines retention.

### Neutral

- Postgres is also used for the `LISTEN`/`NOTIFY` channel that backs
  the outbox publisher (ADR 0014).

## Compliance and Verification

- All schema changes go through versioned SQL migrations; `npm run
  db:migrate:status` is checked in CI.
- Every aggregate has a repository with a Postgres adapter and an in-
  memory adapter; both pass the same contract tests.
- Backup/restore drill is run quarterly per
  [docs/PRODUCTION_READINESS_ASSESSMENT.md](../PRODUCTION_READINESS_ASSESSMENT.md).

## References

- PostgreSQL documentation
- `database/schemas/01_main_schema.sql`
- ADR 0014 — Outbox Pattern
- ADR 0021 — Observability
