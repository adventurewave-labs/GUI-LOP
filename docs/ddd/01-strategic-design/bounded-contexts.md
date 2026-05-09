# Bounded Contexts

A **bounded context** is an explicit boundary within which a model
applies. Inside the boundary, terms have one meaning; across
boundaries, different models can disagree without conflict.

GUI-LOP ships six bounded contexts. Each is a distinct module with
its own domain, application, infrastructure, and interfaces layers
(see [Layered Architecture](../04-implementation-guide/layered-architecture.md)).

## 1. Workflow Orchestration

**Responsibility.** Owns the **Workflow** and **WorkflowTemplate**
aggregates. Drives execution: advances workflows through their
steps, dispatches automated steps, pauses on human steps, and resumes
on human responses.

**Why a context?** The execution lifecycle is rich, has its own
invariants ("a workflow cannot complete with unanswered steps",
"step order is immutable"), and is the platform's core value.

**Code location.** `src/backend/contexts/workflow-orchestration/`

**Detail.** [workflow-orchestration.md](../03-bounded-contexts/workflow-orchestration.md)

## 2. Human Interaction

**Responsibility.** Owns the **HumanResponse** aggregate and the HITL
protocol: deadlines, eligibility, escalation, idempotent recording
of responses.

**Why a context?** The semantics around responses (multi-eligible
reviewers, first-wins, audit) are dense enough to warrant their own
model. Separating from Workflow Orchestration keeps each context
narrow.

**Code location.** `src/backend/contexts/human-interaction/`

**Detail.** [human-interaction.md](../03-bounded-contexts/human-interaction.md)

## 3. Identity & Access

**Responsibility.** Owns **User**, **Role**, **Permission**, and
**Session** aggregates. Issues access and refresh tokens, validates
sessions, answers authorisation questions ("can this user respond
to this workflow step?").

**Why a context?** Authentication and authorisation models are well
understood and reusable. Isolating them lets us swap to an external
IdP later without touching workflow code.

**Code location.** `src/backend/contexts/identity-and-access/`

**Detail.** [identity-and-access.md](../03-bounded-contexts/identity-and-access.md)

## 4. UI Generation

**Responsibility.** Owns the **UISpec** and **UIDocument**
aggregates. Given a step's UI specification and a workflow context,
produces a renderable UI document.

**Why a context?** Generation logic involves template engines,
component catalogues, and (eventually) AI-driven layout. Isolating
it keeps the workflow engine free of rendering concerns.

**Code location.** `src/backend/contexts/ui-generation/`

**Detail.** [ui-generation.md](../03-bounded-contexts/ui-generation.md)

## 5. Notification & Realtime

**Responsibility.** Subscribes to domain events and fans them out to
the right channels: WebSocket push, email, webhook. Manages
subscriber state, channel preferences, and delivery retries.

**Why a context?** Delivery concerns (transports, retries,
channels) are generic and orthogonal to workflow logic.

**Code location.** `src/backend/contexts/notification/`

**Detail.** [notification-and-realtime.md](../03-bounded-contexts/notification-and-realtime.md)

## 6. Audit & Analytics

**Responsibility.** Builds and serves read models: active workflows,
workflow analytics, user activity, audit trails. Provides queries
for dashboards and compliance exports.

**Why a context?** Reads have very different shapes from writes;
analytics queries cut across workflow, user, and event data. A
dedicated context (CQRS-lite read side, ADR 0013) keeps the
operational hot path uncluttered.

**Code location.** `src/backend/contexts/audit-and-analytics/`

**Detail.** [audit-and-analytics.md](../03-bounded-contexts/audit-and-analytics.md)

## Shared Kernel

A small body of shared types lives in `src/backend/shared-kernel/`:

- Common value objects: `UserId`, `WorkflowId`, `Timestamp`.
- The `DomainEvent` base type and the outbox port.
- The `Result` / `Either` helpers used in the domain layer.
- The configuration loader (ADR 0022).
- Cross-cutting error taxonomy.

**Rule.** Anything in the shared kernel is owned jointly by all
context teams; changes require a multi-team review.

## Context Boundaries Are Modules, Not Microservices

In the first release, each bounded context is a module within one
process. The hexagonal layering (ADR 0004) and lint-enforced import
rules keep boundaries clean. Should we later split a context into
its own service, the work is bounded: replace the in-process port
implementation with a network adapter, keep the domain as-is.

## Context Sizing Guidelines

A context should be:

- Owned by a single team (or a clearly nominated steward).
- Coherent in language: one definition per term.
- Small enough that its full model fits in a senior engineer's head.
- Aligned with a subdomain (1-to-1 ideally).

When a context grows beyond these limits, we split it.
