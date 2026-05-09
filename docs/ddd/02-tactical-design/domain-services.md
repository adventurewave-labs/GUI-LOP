# Domain Services

A **domain service** is a piece of behaviour that belongs to the
domain layer but does not naturally fit on a single entity or value
object. Domain services are stateless, named with verbs from the
ubiquitous language, and operate on domain types only.

## When to Reach for One

Use a domain service when the operation:

- Crosses two or more aggregates (read-only) and is part of the
  domain model, e.g. computing eligibility from User and Workflow.
- Is conceptually an action in the domain language but does not
  fit one aggregate's responsibilities.
- Encodes a policy that should not be hidden inside an entity (so
  it can be tested and changed independently).

If the operation reads from a database, calls an external service,
or holds state, it is *not* a domain service. It belongs in the
application or infrastructure layer.

## Catalogue

### Workflow Orchestration

#### `WorkflowExecutionPolicy`
Determines what to do next given a workflow's current state.

```
nextAction(workflow: Workflow): EngineAction
  // returns one of:
  //   AdvanceToNextStep
  //   PauseForHumanInput { stepId, ui_spec }
  //   InvokeExternal { stepId, request }
  //   Complete
  //   Fail { reason }
```

Pure: takes a `Workflow`, returns an `EngineAction`.

#### `StepValidationService`
Validates a step's input/output against its schema and the workflow
context. Pure.

#### `TimeoutPolicyService`
Given a `WorkflowStep` and the current time, returns whether the
step is overdue and what action to take.

### Human Interaction

#### `EligibilityService`
Given a `User`, a `WorkflowStep`, and a `Workflow`, decides whether
that user is an eligible reviewer.

Inputs are domain types; the service does not call repositories.
The repository fetches the data; the service decides.

#### `EscalationPolicyService`
Computes the next escalation level and the new eligibility set when
a step's deadline passes.

### Identity & Access

#### `PasswordHasher` (port + domain wrapper)
The hashing operation itself is infrastructure (uses bcrypt). The
domain owns the **policy** (algorithm, work factor) and exposes a
service that ensures hashes are produced and verified consistently.

#### `AuthorisationService`
Pure decision logic over `User`, `Permission`, and resource scope:

```
isAuthorised(user, permission, scope?): Result<true, ForbiddenReason>
```

Used by other contexts via a port. The `User` and its permissions
are loaded by the application layer; the service is the decision
function.

### UI Generation

#### `LayoutComposer`
Given a `UISpecification` and a `WorkflowContext`, computes a
`Layout` with concrete fields, defaults, and validation. Pure.

#### `ComponentResolver`
Given a `Field` and a `ComponentCatalogue`, picks the right
component and version. Pure (catalogue passed in).

### Notification & Realtime

#### `RoutingPolicy`
Given a domain event and the set of `Subscription`s, returns the
list of `(channel, endpoint)` pairs to deliver to.

#### `RetryPolicy`
Given a `DeliveryAttempt`, decides next retry delay or surrenders
to the dead-letter queue.

### Cross-cutting (Shared Kernel)

#### `Clock`
Returns "now" as a `Timestamp`. Modelled as a port so tests can
freeze time. The implementation is infrastructure; the port is
shared.

#### `IdGenerator`
Returns a new `UUID`. Same pattern.

## Calling Conventions

- Domain services live in `src/backend/contexts/<context>/domain/services/`.
- They export pure functions or stateless classes.
- They receive their dependencies (clock, id generator) by
  parameter or constructor injection — never as module-level
  imports of infrastructure.
- They return `Result<T, DomainError>` where failure modes are
  domain-meaningful (not "DB unavailable").

## Tests

Each domain service has unit tests that:

- Cover every branch of its decision logic.
- Use frozen clocks and deterministic ids.
- Do not import infrastructure modules.

## Anti-Patterns

- **Service as junk drawer.** A `WorkflowService` with twenty
  unrelated methods is not a domain service; it is a missing
  modelling decision. Look for the entity or VO that should own
  the behaviour.
- **Anaemic services on top of anaemic entities.** If the service
  is the only place behaviour lives, the entity is missing
  methods. Push behaviour back to the entity.
- **Infrastructure in disguise.** A "service" that opens a DB
  connection is not a domain service — that's a repository or a
  use case.
