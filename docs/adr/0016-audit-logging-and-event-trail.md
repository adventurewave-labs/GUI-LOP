# 0016. Audit Logging and Append-Only Event Trail

- **Status:** Accepted
- **Date:** 2025-10-26
- **Deciders:** Compliance, Security, Backend team
- **Tags:** compliance, audit, observability

## Context

Workflows produce auditable acts: a human approving a financial
amount, a user changing a workflow template, an admin granting a
role. We need a trustworthy record for compliance investigations,
debugging, and analytics.

The schema already provides:

- `events` — domain events emitted by the system.
- `audit_logs` — generic table mutation log written by Postgres
  triggers (`audit_trigger_function`).

## Decision

We define two complementary trails, both append-only:

- **Domain Event Log (`events` table)** — captures business-level
  facts (workflow created, completed, human responded, UI generated).
  Authored by the domain when an aggregate emits an event; written
  via the outbox (ADR 0014). Used for analytics, replay, and rebuild
  of read models.
- **Technical Audit Log (`audit_logs` table)** — captures every row-
  level INSERT/UPDATE/DELETE on sensitive tables, written by
  Postgres triggers. Used for forensics ("who changed this row at
  what time?") and integrity checks.

Rules:

- Both tables are **append-only**: no UPDATE or DELETE permitted by
  the application user. Retention is driven by policy and lifecycle
  jobs, not in-place edits.
- PII redaction is applied at write time on the technical audit log
  per the data classification policy.
- Sensitive tables enable the audit trigger; non-sensitive ones do
  not, to keep volume manageable. The list lives in
  `database/schemas/`.
- A `changed_by` (user id) and `session_id` are recorded on every
  audit row.

## Alternatives Considered

- **Application-only logging** — easy to bypass; rejected.
- **Database triggers only** — rich, but lacks domain semantics
  ("approved invoice" vs "row updated"). We use both.
- **Full event sourcing** — overkill at this stage; the event log
  gives us the optionality.

## Consequences

### Positive

- Compliance-grade trail without bolting it on later.
- Domain events double as the read-model rebuild source.
- Triggers catch out-of-band fixes (manual SQL).

### Negative / Trade-offs

- Audit volume can be large; we partition `audit_logs` by month and
  archive cold partitions.
- Trigger overhead on hot tables; we measure and exclude tables that
  are not sensitive.

### Neutral

- The domain event types match the WebSocket event types where
  applicable, simplifying frontend handling.

## Compliance and Verification

- A monthly audit-trail review is scheduled.
- A SQL test asserts no UPDATE/DELETE grants on `events` and
  `audit_logs` for the application role.
- Domain events have a registered, versioned schema; missing schemas
  fail CI.

## References

- `database/schemas/01_main_schema.sql` (`audit_trigger_function`)
- ADR 0014 — Outbox
- `docs/COMPLIANCE_DOCUMENTATION.md`
