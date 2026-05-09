# Aggregates

An **aggregate** is a cluster of domain objects treated as a single
unit for the purpose of data changes. The aggregate is referenced
through a single root entity (the **aggregate root**); only the root
is loaded and saved by repositories, and only the root may be held
by other aggregates by reference (id, never object).

## Why Aggregates Matter Here

GUI-LOP is full of multi-step business rules:

- "A workflow may not transition to `completed` if any step is still
  `waiting_for_human`."
- "A human response is recorded once; concurrent submissions all
  see the same outcome."
- "A template version is immutable; the only way to evolve a
  template is to publish a new version."

Without an aggregate boundary, these rules degrade into scattered
checks; with one, the rule is enforced at the point of mutation, by
code that owns the data.

## Aggregate Catalogue

The platform has the following aggregates, by bounded context.

### Workflow Orchestration

#### `WorkflowTemplate` (root)
Children: `Step` (value objects), `TemplateMetadata` (value object).
Invariants:
- `template_key` + `version` is globally unique.
- Steps are non-empty and ordered.
- Step kind is one of `automated | human | external`.
- Once published, a template version is immutable.

Loaded by `template_key` (current version) or `(template_key, version)`.

#### `Workflow` (root)
Children: `WorkflowStep` (entity), `WorkflowTransition` (value
object, one per status change), `WorkflowMetrics` (value object,
derived).
Invariants:
- The set of steps and their order is fixed at creation from a
  template version.
- Status follows the FSM: `created → running → (waiting_for_human ↔
  running)* → completed | failed | cancelled`.
- Cannot be `completed` while any step is still pending.
- `started_at` is set exactly once.
- `completed_at` is set exactly once.

Loaded only by `id`. The `Workflow` aggregate is the consistency
boundary for execution-state changes.

### Human Interaction

#### `HumanResponse` (root)
Children: `ResponseAction` (value object), `ResponsePayload` (value
object), `ResponseRationale` (value object).
Invariants:
- A response is bound to exactly one workflow id and one step id.
- The action is one of the actions the step's UI spec declares as
  valid.
- Idempotent on `(workflow_id, step_id, idempotency_key)`.
- Once recorded, immutable.

Loaded by `id` or by `(workflow_id, step_id)`.

#### `PendingStep` (root, separate from Workflow's step entity)
A read-side projection in this context, with light invariants
useful for HITL operations: deadlines, escalation level,
eligibility cache. Updated by subscribing to Orchestration events.

### Identity & Access

#### `User` (root)
Children: `EmailAddress` (VO), `Username` (VO), `PasswordHash`
(VO), `UserMetadata` (VO).
Invariants:
- `email` and `username` unique.
- `is_active` gates authentication.
- Password hash uses an approved algorithm; setting raw passwords is
  forbidden.

#### `Role` (root)
Children: `Permission` set.
Invariants:
- Role names match the `user_role` enum.
- Permissions follow `<resource>:<action>` naming.

#### `Session` (root)
Children: `RefreshTokenRecord` (entity), `IPAddress` (VO).
Invariants:
- Each session has at most one currently-valid refresh token.
- Sessions expire by `expires_at`; expired sessions cannot
  authenticate.
- Revocation is irreversible (a revoked session never returns).

#### `ApiKey` (root)
Invariants: hashes only; raw key is never stored or logged.

### UI Generation

#### `UISpecification` (root)
Children: `Field` (VO list), `Layout` (VO), `Validation` (VO list).
Invariants:
- Fields have unique names.
- Validation rules reference declared fields.

#### `UIDocument` (root)
Generated artefact. Carries a stable URL and a content reference.
Invariants:
- Bound to a specific workflow id and step id.
- Immutable once published; regeneration produces a new document.

### Notification & Realtime

#### `Subscription` (root)
Children: `Channel` (VO), `Filter` (VO).
Invariants:
- A user may have at most one active subscription per channel for
  the same scope.

(Delivery state — attempts, retries, dead letters — is kept in a
separate `DeliveryAttempt` projection; see
[notification-and-realtime.md](../03-bounded-contexts/notification-and-realtime.md).)

### Audit & Analytics

This context is read-only. It builds projections from events; it
does not own writeable aggregates beyond the projection state
itself.

## Aggregate Design Rules

These rules apply across all contexts.

1. **One transaction = one aggregate.** A use case that changes two
   aggregates does so via two transactions, glued by domain events.
   Cross-aggregate consistency is eventual.
2. **Reference aggregates by id.** A `Workflow` references its
   `WorkflowTemplate` by `(template_key, version)`, never by holding
   the template object.
3. **Small is good.** If the aggregate cannot fit comfortably in
   memory or two engineers cannot agree on what it contains, it is
   too large.
4. **Invariants belong to the root.** Methods on the root mutate
   state. Setters on internals are private to the aggregate.
5. **Events on transition.** Every state change emits a domain
   event; the event is queued in the outbox in the same transaction.
6. **No cross-aggregate domain logic.** A check that requires data
   from another aggregate either uses an injected port (read-only
   query) or is moved to the application layer as orchestration.

## Concurrency

Aggregates use **optimistic concurrency**: each aggregate carries a
`version` (incremented on every write); the repository performs
`WHERE id = ? AND version = ?` and surfaces a conflict to the
caller. Conflicts are not retried automatically; the application
service decides whether to retry, fail, or merge.

For high-contention aggregates (the `Workflow` during a multi-
reviewer human step), the application service serialises responses
through the aggregate, and the second submitter receives a
`409 Conflict` referencing the winning response.

## Persistence

- One repository per aggregate root.
- The repository hides table structure: callers think in aggregates,
  not rows.
- Loads are *complete*: a `Workflow` always loads its steps.
- Saves are *complete*: changes inside an aggregate are persisted
  in one transaction along with the outbox row.

## Anti-Patterns to Avoid

- **Anaemic aggregate**: a class with public setters and no
  behaviour. If the root has no methods enforcing invariants, the
  aggregate is missing.
- **God aggregate**: a `Workflow` that also tries to own users,
  templates, and audit. Split.
- **Direct child save**: a `WorkflowStep` repository that updates a
  step independently of its workflow. Don't.
