# 0012. Human-in-the-Loop Coordination Protocol

- **Status:** Accepted
- **Date:** 2025-10-26
- **Deciders:** Product, Backend team, Frontend team
- **Tags:** workflow, hitl, protocol

## Context

A defining feature of the platform is suspending an automated workflow
to wait for a qualified human, then resuming with their response. The
protocol must:

- Make it impossible to "lose" a human step (no silent timeouts that
  drop progress).
- Allow multiple eligible humans, with the first authoritative
  response winning while still recording the others.
- Provide deadlines, escalation, and visible status to operators.
- Be resilient to server restarts and client disconnects.

## Decision

We define an explicit Human-in-the-Loop (HITL) protocol implemented in
the Workflow Orchestration and Human Interaction bounded contexts:

1. **Pause**: when the engine reaches a `human` step, it transitions
   the workflow to `waiting_for_human`, records the step in
   `workflow_steps`, and emits `workflow.human_input_required`.
2. **Notify**: the Notification context translates the event into
   targeted notifications (WebSocket push, optional email/webhook).
   Eligibility is computed by the Identity & Access context based on
   role and resource scope (ADR 0009).
3. **Generate UI**: the UI Generation context produces a UI spec for
   the step (form, dashboard, etc.) and emits `ui.generated`.
4. **Respond**: an authorised user submits a response via
   `POST /api/workflows/:id/respond`. The Workflow aggregate validates
   the response against the step's expected schema, persists a
   `human_responses` record, transitions to `running`, and continues.
5. **Deadlines**: a step can carry a `deadline` and an `on_timeout`
   policy (`fail`, `escalate`, `auto_approve`). A scheduled job
   evaluates pending steps.
6. **Idempotency**: respond is idempotent on `(workflow_id, step_id,
   client_idempotency_key)`; duplicate submissions return the original
   result (ADR 0024).

Concurrent submissions are serialised by the workflow aggregate; the
first valid response wins and subsequent attempts get a
`409 Conflict`.

## Alternatives Considered

- **Polling with manual claim** — reviewer would need to "claim" the
  task before responding. Reasonable for high-contention queues; we
  defer it until volume justifies it.
- **External BPM tool for HITL only** — adds a second engine without
  removing the need for our own protocol.

## Consequences

### Positive

- Clear, testable lifecycle: every transition is an event.
- Deadlines and escalation are first-class.
- The same protocol covers single-approver and multi-eligible cases.

### Negative / Trade-offs

- More state and more events than a synchronous request/response;
  worth it for the durability and observability gains.
- Idempotency keys put a small burden on clients.

### Neutral

- The protocol is documented in detail in
  `docs/ddd/03-bounded-contexts/human-interaction.md`.

## Compliance and Verification

- Integration tests exercise pause → notify → generate UI → respond,
  including duplicate-submission and timeout cases.
- A "stuck workflow" alert fires when a `waiting_for_human` step
  exceeds 2× its expected SLA.

## References

- ADR 0009 — RBAC
- ADR 0011 — Workflow Templates
- ADR 0024 — Idempotency
