# Ubiquitous Language

This glossary defines the terms used throughout the platform. Each
term has one meaning per bounded context. Where a term means
something different in two contexts, both definitions are listed and
named with the context.

These terms are binding: code identifiers, database columns, API
fields, UI copy, and conversation should match. New synonyms are not
introduced casually.

## Cross-Cutting Terms

**Workflow**
An instance of a process the platform is executing. Created from a
template, has a lifecycle status, accumulates step results and human
responses, and ultimately completes (or fails). One workflow has one
ordered list of steps. Stored in the `workflows` table.

**Workflow Template**
A reusable, versioned definition of a workflow: name, description,
ordered steps, default configuration. Templates are immutable per
version. Stored in the `workflow_templates` table. Created and
edited by privileged users.

**Step**
A single unit of work inside a workflow. A step is either
*automated*, *human*, or *external*. Each step has an order, an
input, an output, and a status.

**Human Step**
A step that pauses the workflow until an authorised human submits a
response. Carries a UI specification, optional deadline, and timeout
policy.

**Automated Step**
A step the engine executes itself (call a service, run a
transformation, evaluate a condition). No human input required.

**External Step**
A step that delegates to an outside system (an AI provider, a
webhook, a third-party API) and resumes when the result returns.

**Human Response**
The act of a user submitting a decision on a human step. Carries an
action (`approve`, `reject`, `modify`, or template-specific), a
data payload, optional reasoning, and an optional confidence score.
Once recorded, immutable.

**Workflow Status**
A finite-state property of a workflow: `created`, `running`,
`waiting_for_human`, `completed`, `failed`, `cancelled`.

**Step Status**
A finite-state property of a step within a workflow, drawn from the
same enum as workflow status.

**Context**
1. (Domain) The dynamic data a workflow is operating on (input
   parameters, intermediate values). Stored in `workflows.context`
   as JSONB.
2. (DDD) A *bounded context* — see strategic design.

When ambiguous, prefer **Workflow Context** for sense (1).

**UI Specification (`ui_spec`)**
A declarative description of what UI to render for a human step:
fields, layout, validation rules. Belongs to the *UI Generation*
context.

**UI Document**
A concrete, generated UI for a specific step instance, derived from
the `ui_spec` plus the workflow's context. Has a URL.

**Domain Event**
An immutable record of something the system has decided happened
(`WorkflowCreated`, `HumanResponseRecorded`). Stored in the `events`
table; published via the outbox.

**Audit Log Entry**
A row-level record of a database change, written by triggers. Used
for forensics and compliance. Distinct from a domain event.

**Idempotency Key**
A client-supplied identifier that makes retries of a mutating
request safe. See ADR 0024.

**Eligible Reviewer**
A user authorised to respond to a particular human step on a
particular workflow, computed from role and resource scope.

**Operator**
A user with a high-privilege role (admin) responsible for keeping
the platform running. Sees dashboards, intervenes when workflows
stall.

## Workflow Orchestration Context

**Engine**
The component that advances a workflow through its steps. The
engine reads templates and contexts, dispatches automated steps,
and pauses on human steps.

**Transition**
A change in workflow or step status, always recorded.

**Run / Execution**
Synonyms for the lifecycle of a single workflow instance.

## Human Interaction Context

**Approval / Decision**
A human response with action `approve` (or `reject`).

**Modify Response**
A human response that *changes* a value the workflow had proposed.
Stored alongside the original proposal.

**Deadline**
Wall-clock time after which a pending human step is considered
overdue.

**Escalation**
The act of widening or shifting the eligible-reviewer set when a
deadline passes, per the step's `on_timeout` policy.

## Identity & Access Context

**User**
A person (or system principal) authenticated by the platform.
Stored in the `users` table.

**Role**
One of `admin`, `user`, `viewer`. A coarse access band.

**Permission**
A fine-grained capability (`workflow:create`, `audit:read`, etc.)
optionally scoped to a resource.

**Session**
An active authenticated context for a user, backed by a refresh
token.

**Access Token**
Short-lived JWT presented on every request.

**Refresh Token**
Long-lived opaque token used to obtain new access tokens.

## UI Generation Context

**Generation Request**
A request to produce a UI document for a step.

**Component Catalogue**
The library of pre-approved components (form fields, dashboards,
charts) that generated UIs draw from.

## Notification & Realtime Context

**Channel**
The medium of delivery: WebSocket push, email, webhook.

**Subscriber**
A connected client (or registered endpoint) for a channel.

**Event Envelope**
The JSON wrapper for any message published to a subscriber:
`{ "type": ..., "version": N, "payload": ... }`.

## Audit & Analytics Context

**Trail**
The append-only sequence of events and audit log entries.

**Active Workflow View**
A read model summarising in-progress workflows for an operator
dashboard.

**Workflow Analytics View**
A read model aggregating workflow throughput, latency, and human-
interaction counts.

## Words We Avoid

These terms have appeared in the codebase or in conversation; they
are *not* part of the language and should be replaced when found:

- **Job** — overloaded with batch processing; use **Workflow**.
- **Task** — overloaded with project management; use **Step**.
- **Process** — too generic; use **Workflow** or **Engine** as
  appropriate.
- **Form** — implementation detail; use **UI Document** or **UI
  Specification**.
- **Notification** as a verb — use **publish** or **deliver**.
