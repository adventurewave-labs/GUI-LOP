# Bounded Context: Human Interaction

> **Subdomain.** Core.
> **Status.** Active, central.
> **Owner.** Workflow team (paired with Orchestration).
> **Code.** `src/backend/contexts/human-interaction/`

## Purpose

Implement the Human-in-the-Loop coordination protocol (ADR 0012):
record human responses, manage deadlines and escalation, ensure
idempotency, and notify Orchestration so workflows can resume.

## Ubiquitous Language (Local Additions)

- **Pending Step** — a workflow step in `waiting_for_human` from
  this context's perspective: who can respond, by when, what UI
  is showing.
- **Eligible Reviewer** — a user authorised to respond to a
  particular pending step.
- **Resolution** — the moment the first valid response is
  recorded; the pending step is then closed.
- **Escalation** — widening the eligible-reviewer set after a
  deadline passes.

## Aggregates

### `HumanResponse`

```
HumanResponse
├── identity: HumanResponseId
├── workflow_id: WorkflowId
├── step_id: StepId
├── responder: UserId
├── action: ResponseAction (VO)
├── payload: ResponsePayload (VO)
├── rationale: ResponseRationale? (VO)
├── confidence: ConfidenceScore? (VO)
├── idempotency_key: IdempotencyKey
├── recorded_at: Timestamp
└── pending_events
```

Invariants:

- One response per `(workflow_id, step_id, idempotency_key)`.
- `action` is one of the actions declared by the step's UI spec.
- Payload conforms to the response schema declared by the step.
- Once recorded, immutable.

### `PendingStep`

A projection updated from Orchestration events
(`workflow.human_input_required`, `human_response.recorded`,
`workflow.cancelled`).

```
PendingStep
├── identity: (WorkflowId, StepId)
├── ui_document_id: UIDocumentId?
├── eligible: EligibilityRule (VO)
├── deadline: Timestamp?
├── on_timeout: TimeoutPolicy (VO)
├── escalation_level: integer
└── opened_at, closed_at?
```

Invariants:

- Closed pending steps cannot reopen.
- `escalation_level` is monotonic.

## Domain Services

- `EligibilityService.eligibleFor(user, pendingStep, workflow): boolean`
  — pure function over loaded domain types.
- `EscalationPolicyService.next(pendingStep, now): NextLevel | None`
  — decides whether to escalate.
- `ResponseValidationService.validate(action, payload, step): Result`
  — uses the step's UI spec/response schema.

## Use Cases

### Commands

- `RecordHumanResponse({ workflow_id, step_id, action, payload,
  actor, idempotency_key })`
  - Loads `Workflow` (read-only summary) for step lookup.
  - Calls `AuthorisationService` (port to Identity) for
    `workflow:respond` with scope = workflow id.
  - Calls `EligibilityService`.
  - Validates payload via `ResponseValidationService`.
  - Persists `HumanResponse`, calls Orchestration's
    `AdvanceWorkflow` use case as part of the same logical flow,
    and emits `human_response.recorded`.
  - Idempotent on the supplied key.

- `EscalateOverdueStep({ workflow_id, step_id })`
  - Called by the deadline watcher.
  - Computes new escalation level and updates eligibility.
  - Emits `human_step.escalated` (or `human_step.deadline_passed` if
    the policy is `fail`).

- `CloseAbandonedStep({ workflow_id, step_id, policy })`
  - Triggered when a workflow is cancelled or fails while a step
    pends.

### Queries

- `ListPendingStepsForUser(userId, filter)` — for the inbox UI.
- `GetPendingStep(workflowId, stepId)`.

## Repositories

- `HumanResponseRepository`
- `PendingStepRepository`

## Inbound Adapters

### REST

| Method | Path                                            | Use Case                      |
| ------ | ----------------------------------------------- | ----------------------------- |
| POST   | `/api/v1/workflows/:id/respond`                 | `RecordHumanResponse`         |
| GET    | `/api/v1/inbox`                                 | `ListPendingStepsForUser`     |
| GET    | `/api/v1/inbox/:workflowId/:stepId`             | `GetPendingStep`              |

### WebSocket

Subscribes to `workflow.human_input_required`,
`human_response.recorded`, `human_step.escalated`,
`human_step.deadline_passed` for the connected user.

### Scheduled Jobs

- **Deadline watcher** — every N seconds, runs
  `EscalateOverdueStep` for all pending steps whose deadline has
  passed.

## Outbound Dependencies

- **Identity & Access** (port): `AuthorisationService`,
  `UserDirectoryReader` (for eligibility computation).
- **Workflow Orchestration** (port): `AdvanceWorkflow` use case
  invoked after a response is recorded.
- **Outbox** (port).

## Domain Events Produced

- `human_response.recorded`
- `human_step.escalated`
- `human_step.deadline_passed`

## Persistence

- `human_responses` — `HumanResponse` aggregate.
- `pending_steps` — projection; ix on `(deadline, status)` for the
  watcher.

## Risks and Pitfalls

- **Race between response and timeout.** A response arriving at the
  same instant as a deadline must be authoritative. The aggregate
  resolves this via optimistic concurrency: a response that wins
  closes the pending step before the watcher can escalate.
- **Eligibility drift.** A user's permissions may change while a
  step is pending. Eligibility is computed at submission time, not
  at notification time.
- **Audit completeness.** Multiple submissions must all be auditable
  (winner + losers); we record losers as `human_response.attempted`
  audit events even though they are not domain `human_response.recorded`
  events.

## Open Questions

- **Multi-signature approvals** (e.g. "any two of N must approve").
  Modelled as a single conceptual step with a quorum-resolution
  policy; design captured separately.
