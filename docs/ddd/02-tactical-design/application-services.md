# Application Services

The **application layer** orchestrates domain objects to fulfil use
cases. It is thin: it loads aggregates, calls domain methods,
persists results, publishes events, and translates between transport
DTOs and domain types. It contains *no business rules* — those live
in the domain layer.

## Use Cases (Commands)

A command is a single, intention-revealing operation that mutates
state. We model each as a small class or function with a clear
input and a clear outcome.

### Pattern

```ts
// application/commands/create-workflow.ts
interface CreateWorkflowInput {
  templateKey: TemplateKey;
  context: WorkflowContext;
  actor: UserId;
  idempotencyKey?: IdempotencyKey;
}

class CreateWorkflowUseCase {
  constructor(
    private templates: WorkflowTemplateRepository,
    private workflows: WorkflowRepository,
    private outbox: OutboxRepository,
    private uow: UnitOfWorkFactory,
    private clock: Clock,
    private ids: IdGenerator,
  ) {}

  async execute(input: CreateWorkflowInput): Promise<WorkflowId> {
    const tmpl = await this.templates.findCurrent(input.templateKey);
    if (!tmpl) throw new NotFound("template");

    return this.uow.run(async (tx) => {
      const wf = Workflow.createFromTemplate({
        id: WorkflowId.from(this.ids.next()),
        template: tmpl,
        context: input.context,
        createdBy: input.actor,
        now: this.clock.now(),
      });
      await this.workflows.save(wf, tx);
      await this.outbox.enqueue(wf.pullEvents(), tx);
      return wf.id;
    });
  }
}
```

Notes:
- The use case opens a single unit of work.
- It pulls events off the aggregate and enqueues them in the same
  transaction.
- It does not know about HTTP, WebSockets, or JSON.

### Catalogue (selected)

| Context              | Command                              |
| -------------------- | ------------------------------------ |
| Workflow Orchestration | `PublishWorkflowTemplate`          |
| Workflow Orchestration | `DeprecateWorkflowTemplate`        |
| Workflow Orchestration | `CreateWorkflow`                   |
| Workflow Orchestration | `ExecuteWorkflow`                  |
| Workflow Orchestration | `AdvanceWorkflow`                  |
| Workflow Orchestration | `CancelWorkflow`                   |
| Human Interaction     | `RecordHumanResponse`              |
| Human Interaction     | `EscalateOverdueStep`              |
| Identity & Access     | `RegisterUser`                     |
| Identity & Access     | `AuthenticateUser`                 |
| Identity & Access     | `RefreshSession`                   |
| Identity & Access     | `RevokeSession`                    |
| Identity & Access     | `GrantPermission`                  |
| Identity & Access     | `RevokePermission`                 |
| UI Generation         | `GenerateUIForStep`                |
| Notification          | `Subscribe`                        |
| Notification          | `Unsubscribe`                      |

## Queries

Queries return **view models** (DTOs), bypass aggregates, and read
from views or denormalised tables (CQRS-lite, ADR 0013). They do
not mutate state.

### Pattern

```ts
// application/queries/list-active-workflows.ts
interface ListActiveWorkflowsFilter {
  byUser?: UserId;
  byTemplate?: TemplateKey;
  page?: PageToken;
}

class ListActiveWorkflowsQuery {
  constructor(private db: ReadOnlyDb) {}

  async execute(f: ListActiveWorkflowsFilter): Promise<Page<ActiveWorkflowView>> {
    return this.db.query<ActiveWorkflowView>(`
      SELECT id, template_key, status, created_at, started_at, duration
      FROM active_workflows
      WHERE ($1::uuid IS NULL OR created_by = $1)
        AND ($2::text IS NULL OR template_key = $2)
      ORDER BY created_at DESC
      LIMIT 50
    `, [f.byUser ?? null, f.byTemplate ?? null]);
  }
}
```

### Catalogue (selected)

| Context              | Query                                |
| -------------------- | ------------------------------------ |
| Workflow Orchestration | `ListWorkflowTemplates`            |
| Workflow Orchestration | `GetWorkflowDetail`                |
| Workflow Orchestration | `ListActiveWorkflows`              |
| Human Interaction     | `ListPendingStepsForUser`          |
| Identity & Access     | `GetUserProfile`                   |
| Audit & Analytics     | `GetWorkflowAnalytics`             |
| Audit & Analytics     | `GetUserActivity`                  |
| Audit & Analytics     | `GetAuditTrail`                    |

## Cross-Cutting Concerns

### Authorisation
Every command is wrapped (via a decorator or a single dispatch
function) by a check against the `AuthorisationService` from
Identity. The check is part of the application layer, not the
domain.

### Idempotency
Mutating commands accept an optional `IdempotencyKey`. If present,
the application layer:

1. Looks up `(actor, command_name, key)` in the idempotency store.
2. If found, returns the stored response.
3. Otherwise, runs the command and stores the response.

See ADR 0024.

### Transactions
A unit-of-work factory provides transactional scope. Commands open
exactly one transaction; they do not nest.

### Error mapping
The application layer raises domain-typed errors (`NotFound`,
`Conflict`, `Forbidden`, `ValidationError`). Inbound adapters map
them to transport-specific errors (HTTP 4xx, WebSocket close
codes).

### Logging and tracing
Every command sets a span and structured log fields:
`command_name`, `actor`, `correlation_id`, key aggregate ids.

### Events
Commands always pull events off mutated aggregates and enqueue them
in the outbox in the same transaction. They never publish directly.

## Inbound Adapters Call the Application Layer, Not the Domain

- Express route handlers parse and validate input, then call a use
  case.
- WebSocket message handlers do the same.
- Background jobs (e.g. the timeout watcher) call use cases.
- CLI scripts in `scripts/` call use cases.

This means the domain has zero awareness of how it is being driven.

## Testing

Application-service tests:

- Use in-memory adapters for repositories, outbox, and clock.
- Cover happy-path behaviour and the major failure modes.
- Verify the events emitted (not just the persisted state).

Integration tests cover the same use cases with the real adapters
under testcontainers.

## Anti-Patterns

- **Logic creeping into use cases.** If a use case starts deciding
  things ("if status is X and role is Y, then …"), that decision
  belongs in a domain service or aggregate.
- **Direct repository writes from controllers.** Controllers call
  use cases; they do not load and save aggregates.
- **Side effects outside the transaction.** Sending an email or a
  WebSocket message from inside a use case bypasses the outbox.
  Always go through events.
