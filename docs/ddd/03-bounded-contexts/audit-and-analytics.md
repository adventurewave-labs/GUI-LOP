# Bounded Context: Audit & Analytics

> **Subdomain.** Generic.
> **Status.** Active.
> **Owner.** Platform team (with compliance steward).
> **Code.** `src/backend/contexts/audit-and-analytics/`

## Purpose

Maintain a trustworthy, queryable history of what happened in the
platform, and provide read models for operator dashboards,
compliance exports, and product analytics. The context is read-
only on its own data domain: it consumes events emitted by other
contexts and projects them into shapes optimised for query.

## Ubiquitous Language (Local Additions)

- **Trail** — the append-only sequence of domain events for an
  aggregate or scope.
- **Projection** — a denormalised read shape derived from events
  (and, where useful, from row-level audit logs).
- **Compliance Export** — a packaged subset of trail data
  suitable for handing to auditors.

## Read Models (Projections)

These are not aggregates; they are tables/views maintained by event
handlers in this context.

### `active_workflows` (view, ships in schema)
Active workflows with template, creator, status, and current
duration. Drives operator dashboards.

### `workflow_analytics` (view, ships in schema)
Daily aggregates of workflow throughput and average execution
times by template and status.

### `user_activity` (view, ships in schema)
Per-user counts: workflows created, sessions started, human
responses recorded.

### `pending_inbox_view`
Per-user list of pending steps with deadlines and SLA traffic
lights.

### `audit_trail` (composite)
Joins `events` and `audit_logs` for incident investigation.

## Use Cases

This context is dominated by *queries*; commands are limited to
projection-state housekeeping (rebuild, backfill).

### Queries

- `GetWorkflowAnalytics(filter)`
- `GetUserActivity(user_id_or_filter)`
- `GetActiveWorkflows(filter)`
- `GetAuditTrail({ aggregate_type, aggregate_id, range })`
- `GetWorkflowTrail({ workflow_id })`
- `ExportComplianceData({ scope, range })` — produces a signed
  archive.

### Commands (housekeeping only)

- `RebuildProjection(name)` — admin-only; replays from the
  `events` table.
- `BackfillAuditTrail(range)` — fills gaps after schema changes.

## Inbound Adapters

### REST (under `/api/v1/audit`, `/api/v1/analytics`)

| Method | Path                                          | Use Case                 |
| ------ | --------------------------------------------- | ------------------------ |
| GET    | `/analytics/workflows`                        | `GetWorkflowAnalytics`   |
| GET    | `/analytics/users/:id`                        | `GetUserActivity`        |
| GET    | `/audit/workflows/:id`                        | `GetWorkflowTrail`       |
| GET    | `/audit/aggregates/:type/:id`                 | `GetAuditTrail`          |
| POST   | `/audit/exports`                              | `ExportComplianceData`   |
| GET    | `/dashboards/active-workflows`                | `GetActiveWorkflows`     |
| POST   | `/admin/projections/:name/rebuild`            | `RebuildProjection`      |

### Event Subscribers

Subscribe to `workflow.*`, `human_response.*`, `user.*`,
`session.*`, `permission.*`, `ui.*`, `notification.*` events for
projection updates.

## Outbound Dependencies

- **Read DB** (Postgres, possibly read replica) — for query
  performance.
- **Object storage** (port) for compliance export artefacts.

## Persistence

- `events` — the source of truth for the trail.
- `audit_logs` — row-level technical trail.
- View definitions in `database/schemas/01_main_schema.sql`:
  `active_workflows`, `workflow_analytics`, `user_activity`.
- Optional materialised views for heavy dashboards (refresh
  policy: scheduled).

## Retention and Privacy

- `events` and `audit_logs` are append-only and partitioned by
  month.
- Cold partitions are archived to object storage after a configured
  age; an index in the active store points to the archive.
- PII redaction is applied at write time on `audit_logs` per the
  data classification policy.
- Right-to-erasure (when added) is implemented as a tombstone in
  the affected aggregates plus a redaction pass over old partitions
  with a logged justification.

## Risks and Pitfalls

- **Projection lag**: dashboards show stale data when the publisher
  is behind. Lag is exposed as a metric (ADR 0021) and dashboards
  display the freshness timestamp.
- **Schema evolution**: adding a field to an event type does not
  require backfill (additive). Removing or renaming requires a
  rebuild plan.
- **Audit volume**: trigger-based audit can balloon. Limit the
  audit-triggered tables, partition `audit_logs`, and archive
  cold partitions.

## Open Questions

- **External BI tool integration**: a daily export to a warehouse
  (Snowflake/BigQuery) is planned; the export is a one-way ETL job
  in this context.
- **Per-tenant analytics** when multi-tenancy lands.
