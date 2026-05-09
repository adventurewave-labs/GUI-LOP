# Bounded Context: Workflow Orchestration

> **Subdomain.** Core.
> **Status.** Active, central.
> **Owner.** Workflow team.
> **Code.** `src/backend/contexts/workflow-orchestration/`

## Purpose

Own the lifecycle of workflows: define templates, create instances,
execute steps, pause for human input, and complete or fail. This is
the platform's core domain.

## Ubiquitous Language (Local Additions)

- **Engine** — the orchestrator that advances a workflow.
- **Step Dispatcher** — the part of the engine that delegates a
  step to its kind-specific handler (automated / external / human).
- **Step Output** — the result of an automated or external step;
  becomes part of the workflow context.
- **Run** — informal alias for a `Workflow` instance from creation
  through terminal status.

## Aggregates

### `WorkflowTemplate`

```
WorkflowTemplate
├── identity: TemplateKey + TemplateVersion
├── name, description
├── steps: ordered list of StepDefinition (VO)
├── default_config: JSONB (VO)
├── status: draft | published | deprecated
└── timestamps
```

Invariants:

- `(template_key, version)` is unique.
- `steps` is non-empty; each step has a unique name.
- After `publish()`, the template's content is immutable.

Behaviour:

- `publish()`, `deprecate()`, `validateStructure()`.

### `Workflow`

```
Workflow
├── identity: WorkflowId
├── template_ref: (TemplateKey, TemplateVersion)
├── context: WorkflowContext (VO, evolves)
├── status: WorkflowStatus
├── steps: WorkflowStep[] (entities, ordered, fixed at creation)
├── transitions: WorkflowTransition[] (VO list, append-only)
├── created_by, created_at, started_at?, completed_at?
├── version (for optimistic concurrency)
└── pending_events: DomainEvent[] (cleared by repository on save)
```

Invariants:

- Steps are fixed at creation; their order matches the template.
- Status transitions follow the FSM (see below).
- `started_at` set on first transition out of `created`.
- `completed_at` set on transition into a terminal status.
- A workflow may not be `completed` while any step is non-terminal.

Behaviour (selected):

- `start(now)`
- `nextAction()` → `EngineAction` (delegates to
  `WorkflowExecutionPolicy`)
- `recordStepOutput(stepId, output)`
- `markStepWaitingForHuman(stepId, ui_spec)`
- `applyHumanResponse(stepId, response)`
- `cancel(by, reason)`
- `fail(reason)`

Each method emits zero or more `DomainEvent`s onto
`pending_events`.

## Finite-State Machines

### Workflow Status

```
              ┌─── cancel ──┐
              │             ▼
created ─── start ──▶ running ──▶ completed
              │         │   ▲
              │         │   │
              │         ▼   │
              │   waiting_for_human
              │         │
              │         ▼
              │   running (after response)
              ▼
            failed
```

Transitions are encoded as a transition table in
`WorkflowExecutionPolicy`; illegal transitions raise
`InvalidStateTransition` from the aggregate.

### Step Status

Each step carries a status from the same enum, advancing through
`created → running → (waiting_for_human ↔ running)? → completed |
failed`.

## Domain Services

- `WorkflowExecutionPolicy.nextAction(workflow): EngineAction`
- `StepValidationService.validateInput(step, ctx)`,
  `validateOutput(step, output)`
- `TimeoutPolicyService.evaluate(step, now): TimeoutAction`

## Use Cases (Application Layer)

### Commands

- `PublishWorkflowTemplate(input)` — admin-only.
- `DeprecateWorkflowTemplate(key, version)`.
- `CreateWorkflow(template_key, context, actor)` — emits
  `workflow.created`.
- `ExecuteWorkflow(id, actor)` — transitions `created → running`,
  invokes the engine until pause or terminal status; emits
  `workflow.started`, `workflow.step_started`, possibly
  `workflow.human_input_required`, `workflow.completed`.
- `AdvanceWorkflow(id)` — internal; called by the engine after a
  human response or external callback.
- `CancelWorkflow(id, reason, actor)`.

### Queries

- `ListWorkflowTemplates({ active })`
- `GetWorkflowTemplate(key, version?)`
- `GetWorkflowDetail(id)` (joins steps and metrics)
- `ListActiveWorkflows(filter)`

## Repositories

- `WorkflowTemplateRepository`
- `WorkflowRepository`

Both have Postgres adapters and in-memory adapters that pass the
same contract suite.

## Inbound Adapters

### REST (under `/api/v1/workflows`)

| Method | Path                                  | Use Case                     |
| ------ | ------------------------------------- | ---------------------------- |
| GET    | `/templates`                          | `ListWorkflowTemplates`      |
| POST   | `/templates`                          | `PublishWorkflowTemplate`    |
| POST   | `/`                                   | `CreateWorkflow`             |
| GET    | `/:id`                                | `GetWorkflowDetail`          |
| POST   | `/:id/execute`                        | `ExecuteWorkflow`            |
| POST   | `/:id/cancel`                         | `CancelWorkflow`             |

`POST /:id/respond` is owned by the Human Interaction context but
mounted on the same path tree for client convenience.

### WebSocket

Subscriptions to `workflow.*` events for the connected user's
visible workflows.

## Outbound Dependencies

- **Identity & Access** (port): `AuthorisationService`.
- **UI Generation** (port): `UIGenerationService` for human steps.
- **Outbox** (port): `OutboxRepository`.

## Domain Events Produced

See [domain-events.md](../02-tactical-design/domain-events.md):

- `template.published`, `template.deprecated`
- `workflow.created`, `workflow.started`, `workflow.step_started`,
  `workflow.step_completed`, `workflow.step_failed`,
  `workflow.human_input_required`, `workflow.completed`,
  `workflow.failed`, `workflow.cancelled`

## Persistence

Tables (see `database/schemas/01_main_schema.sql`):

- `workflow_templates` — `WorkflowTemplate` aggregate.
- `workflows` — `Workflow` aggregate root.
- `workflow_steps` — `WorkflowStep` entities under `Workflow`.
- `workflow_metrics` — derived/projected, written by analytics
  consumers.

Reads use the views `active_workflows` and `workflow_analytics`.

## Risks and Pitfalls

- **Long-running workflows accumulating large `context` JSONB**
  blobs. Keep context lean; archive completed workflows per
  retention policy.
- **Engine reentrance.** Two callers executing the same workflow
  must serialise on the aggregate; optimistic concurrency on
  `Workflow.version` enforces this.
- **Step branching.** Out of scope for v1; revisit when product
  needs it.

## Open Questions

- Versioned step migrations: when a workflow instance is in flight
  and a new template version is published, should it follow the new
  shape? Default: no — instance is bound to its template version.
- Sub-workflows (a step that itself is a workflow): not modelled
  yet; backlog.
