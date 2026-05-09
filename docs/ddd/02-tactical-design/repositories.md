# Repositories

A **repository** mediates between the domain and the data store. It
loads aggregates by identity and persists them. Code outside the
repository thinks in aggregates; only the repository knows about
tables, JSONB columns, joins, and SQL.

## Rules

1. **One repository per aggregate root.** No "shared DAO".
2. **Aggregate-shaped reads.** Loading a `Workflow` returns the
   workflow with its steps and metrics — never a partial graph.
3. **Aggregate-shaped writes.** Saving a `Workflow` persists all
   changes inside the aggregate atomically, plus any domain events
   into the outbox.
4. **No domain logic.** Repositories validate nothing beyond shape;
   the domain has already validated.
5. **Ports first, adapters later.** The repository interface lives
   in the application layer; the implementation lives in
   infrastructure. The domain depends on neither.
6. **No raw rows escape.** Callers receive entities/VOs, never row
   shapes.
7. **No leaky transactions.** A repository accepts an optional
   `UnitOfWork` (or transaction) handle and uses it; it does not
   start its own transaction silently.

## Catalogue

### Workflow Orchestration

#### `WorkflowTemplateRepository`

```ts
interface WorkflowTemplateRepository {
  findCurrent(key: TemplateKey): Promise<WorkflowTemplate | null>;
  findVersion(key: TemplateKey, version: TemplateVersion): Promise<WorkflowTemplate | null>;
  save(template: WorkflowTemplate, uow?: UnitOfWork): Promise<void>;
  list(filter: TemplateFilter): Promise<WorkflowTemplate[]>;
}
```

Backed by `workflow_templates`.

#### `WorkflowRepository`

```ts
interface WorkflowRepository {
  findById(id: WorkflowId): Promise<Workflow | null>;
  save(workflow: Workflow, uow: UnitOfWork): Promise<void>;
  // narrow read used by use cases that need to check existence
  // without hydrating the full aggregate
  status(id: WorkflowId): Promise<WorkflowStatus | null>;
}
```

Backed by `workflows` + `workflow_steps`. Save uses optimistic
concurrency on a `version` column.

### Human Interaction

#### `HumanResponseRepository`

```ts
interface HumanResponseRepository {
  findById(id: HumanResponseId): Promise<HumanResponse | null>;
  findFor(workflowId: WorkflowId, stepId: StepId): Promise<HumanResponse[]>;
  findByIdempotencyKey(
    workflowId: WorkflowId,
    stepId: StepId,
    key: IdempotencyKey,
  ): Promise<HumanResponse | null>;
  save(response: HumanResponse, uow: UnitOfWork): Promise<void>;
}
```

Backed by `human_responses`.

#### `PendingStepRepository`

```ts
interface PendingStepRepository {
  findOverdue(now: Timestamp, limit: number): Promise<PendingStep[]>;
  upsert(step: PendingStep, uow: UnitOfWork): Promise<void>;
  remove(workflowId: WorkflowId, stepId: StepId, uow: UnitOfWork): Promise<void>;
}
```

A projection updated from Orchestration events.

### Identity & Access

#### `UserRepository`

```ts
interface UserRepository {
  findById(id: UserId): Promise<User | null>;
  findByEmail(email: EmailAddress): Promise<User | null>;
  findByUsername(username: Username): Promise<User | null>;
  save(user: User, uow?: UnitOfWork): Promise<void>;
}
```

#### `RoleRepository`, `SessionRepository`, `ApiKeyRepository`

Standard shape; `SessionRepository` additionally exposes
`revoke(sessionId)` and `findActiveByRefreshToken(hash)`.

### UI Generation

#### `UISpecificationRepository`
Read-mostly. Specs are typically embedded in templates, but the
context cache is its own repository.

#### `UIDocumentRepository`
Persists generated documents and their addressable URLs.

### Notification & Realtime

#### `SubscriptionRepository`

```ts
interface SubscriptionRepository {
  findForUser(userId: UserId): Promise<Subscription[]>;
  findForChannel(channel: Channel, scope: ScopeId): Promise<Subscription[]>;
  save(s: Subscription, uow?: UnitOfWork): Promise<void>;
  remove(id: SubscriptionId, uow?: UnitOfWork): Promise<void>;
}
```

#### `OutboxRepository` (shared kernel)

```ts
interface OutboxRepository {
  enqueue(events: DomainEvent[], uow: UnitOfWork): Promise<void>;
  pickBatch(size: number): Promise<OutboxEntry[]>;
  markDispatched(ids: OutboxEntryId[]): Promise<void>;
  markFailed(id: OutboxEntryId, reason: string): Promise<void>;
}
```

The outbox is owned by the shared kernel because every context
writes to it.

### Audit & Analytics

This context's "repositories" are query services; see
[application-services.md](application-services.md). They expose
methods like `getActiveWorkflows(filter)` that return view-model
DTOs, not aggregates.

## Implementation Notes

- The Postgres adapter uses parameterised queries; no string
  concatenation.
- JSONB columns are accessed through typed helpers; we never
  inline `->` selectors at call sites.
- Soft delete is not used; deletions are explicit and audit-logged.
- Pagination is keyset where order matters (created_at + id), with
  page tokens; offset pagination is used only for ad-hoc admin
  views.
- Caching: a Redis-backed decorator may wrap a repository; cache
  invalidation is event-driven (ADR 0014).

## Testing

Each repository has:

- A **contract test** (`tests/contracts/<repo>.spec.ts`) that runs
  against:
  - the in-memory adapter (used by application-layer tests),
  - the Postgres adapter (under testcontainers).
- Both adapters must pass the same suite, ensuring the in-memory
  adapter is a faithful test double.

## Anti-Patterns

- **Generic repository.** A `Repository<T>` with `findAll`,
  `findOne`, etc. encourages anaemic models. Keep repositories
  named after aggregates.
- **Cross-aggregate queries inside repositories.** "Find workflows
  whose user is …" belongs in a query service.
- **Leaky transaction management.** A repository that opens or
  commits transactions on its own makes use cases unable to span
  multiple writes.
