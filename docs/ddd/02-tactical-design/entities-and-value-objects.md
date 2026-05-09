# Entities and Value Objects

## Entities vs Value Objects

- **Entity**: has a stable identity that persists through state
  changes. Two entities with the same field values but different ids
  are different entities. Examples: `User`, `Workflow`, `Session`.
- **Value Object (VO)**: has no identity; it is defined entirely by
  its attributes. Two VOs with the same attributes are equal. VOs
  are immutable. Examples: `EmailAddress`, `Permission`,
  `WorkflowStatus`, `Timestamp`.

When in doubt, prefer a value object. Value objects are easier to
reason about, easier to test, and impossible to accidentally mutate.

## Catalogue

### Shared Kernel

| Type            | Kind | Notes                                              |
| --------------- | ---- | -------------------------------------------------- |
| `UserId`        | VO   | Branded UUID. Validated at construction.           |
| `WorkflowId`    | VO   | Branded UUID.                                      |
| `StepId`        | VO   | Branded UUID.                                      |
| `Timestamp`     | VO   | ISO-8601 wrapper; comparable; never `null`.        |
| `IdempotencyKey`| VO   | UUID or 16-64 char alphanumeric.                   |
| `Result<T, E>`  | VO   | Functional success/failure container.              |
| `DomainEvent`   | Base | Abstract; concrete events extend.                  |

### Workflow Orchestration

#### Entities

| Entity         | Lives in              | Identity       |
| -------------- | --------------------- | -------------- |
| `Workflow`     | Workflow aggregate    | `WorkflowId`   |
| `WorkflowStep` | Workflow aggregate    | `StepId`       |

#### Value Objects

| VO                   | Description                                       |
| -------------------- | ------------------------------------------------- |
| `WorkflowStatus`     | Enum: `created`, `running`, `waiting_for_human`, `completed`, `failed`, `cancelled`. |
| `StepKind`           | Enum: `automated`, `human`, `external`.           |
| `StepDefinition`     | Name, kind, input schema ref, output schema ref, optional `ui_spec`, deadline, on_timeout. |
| `WorkflowContext`    | Immutable JSON wrapper of workflow inputs/intermediate values; copy-on-write. |
| `WorkflowTransition` | `(from, to, at, reason?)` record of a status change. |
| `TemplateKey`        | Lower-kebab string, validated.                    |
| `TemplateVersion`    | SemVer-like integer triple or simple integer.     |
| `WorkflowMetrics`    | Derived counts: total steps, completed steps, human interactions, duration. |
| `ExecutionDeadline`  | Optional wall-clock time + on_timeout policy.     |

### Human Interaction

#### Entities

| Entity          | Identity                         |
| --------------- | -------------------------------- |
| `HumanResponse` | `HumanResponseId` (VO)           |
| `PendingStep`   | `(WorkflowId, StepId)`           |

#### Value Objects

| VO                  | Description                                     |
| ------------------- | ----------------------------------------------- |
| `ResponseAction`    | One of: `approve`, `reject`, `modify`, plus template-defined custom actions. |
| `ResponsePayload`   | JSON wrapper validated against the step's response schema. |
| `ResponseRationale` | Optional free-text reasoning, length-bounded.   |
| `ConfidenceScore`   | Decimal in [0, 1].                              |
| `EligibilityRule`   | Predicate over user attributes (role, scope).   |
| `EscalationLevel`   | Integer, monotonically increasing per step.     |

### Identity & Access

#### Entities

| Entity      | Identity            |
| ----------- | ------------------- |
| `User`      | `UserId`            |
| `Role`      | `RoleName` (VO)     |
| `Session`   | `SessionId` (VO)    |
| `ApiKey`    | `ApiKeyId` (VO)     |

#### Value Objects

| VO              | Description                                      |
| --------------- | ------------------------------------------------ |
| `EmailAddress`  | RFC-validated; lowercased.                       |
| `Username`      | 3–100 chars, kebab/underscore.                   |
| `PasswordHash`  | Algorithm + salt + hash; never accepts plaintext.|
| `Permission`    | `<resource>:<action>[@<scope>]`.                 |
| `RoleName`      | Enum: `admin`, `user`, `viewer`.                 |
| `JwtClaims`     | Bounded set of claim fields with types.          |
| `IPAddress`     | Validated IPv4/IPv6.                             |
| `UserAgent`     | Bounded-length string.                           |
| `RefreshTokenSecret` | Opaque, hashed at rest.                     |

### UI Generation

#### Entities

| Entity            | Identity            |
| ----------------- | ------------------- |
| `UISpecification` | `UISpecId` (VO)     |
| `UIDocument`      | `UIDocumentId` (VO) |

#### Value Objects

| VO                | Description                                    |
| ----------------- | ---------------------------------------------- |
| `Field`           | Name, label, type, required, default.          |
| `FieldType`       | Enum: `text`, `number`, `select`, `multiselect`, `date`, `boolean`, `file`. |
| `ValidationRule`  | Field name + rule (regex, range, custom).      |
| `Layout`          | Section + ordering description.                |
| `ComponentRef`    | Component catalogue entry id + version.        |

### Notification & Realtime

#### Entities

| Entity         | Identity                |
| -------------- | ----------------------- |
| `Subscription` | `SubscriptionId` (VO)   |

#### Value Objects

| VO                | Description                                |
| ----------------- | ------------------------------------------ |
| `Channel`         | Enum: `websocket`, `email`, `webhook`.     |
| `EventEnvelope`   | `{ type, version, payload, occurred_at }`. |
| `DeliveryAttempt` | Result + at + retry count.                 |
| `EndpointAddress` | URL or email address.                      |

### Audit & Analytics

This context is read-only; the value objects it uses are mostly
DTOs for query results (`ActiveWorkflowView`, `WorkflowAnalyticsRow`,
`UserActivityRow`). They are not aggregates; they are projections.

## Construction Rules

- **Always validate at the boundary.** A VO constructor either
  returns a valid instance or throws / returns `Result.err`. There
  are no "partially constructed" VOs.
- **Make illegal states unrepresentable.** Use union types and
  enums; do not encode meaning in nullable fields where a sum type
  is clearer.
- **Equality.** VOs implement structural equality. Entities are
  equal iff their ids are equal.
- **Immutability.** VOs use `readonly` (TypeScript) or
  `Object.freeze` patterns. Mutating an entity returns the entity
  itself; mutating a VO returns a new instance.

## Examples (TypeScript-flavoured pseudocode)

```ts
// Value object — branded type with smart constructor
type EmailAddress = string & { readonly __brand: "EmailAddress" };
function emailAddress(raw: string): Result<EmailAddress, ValidationError> {
  const trimmed = raw.trim().toLowerCase();
  return EMAIL_RE.test(trimmed)
    ? Result.ok(trimmed as EmailAddress)
    : Result.err(new ValidationError("invalid email"));
}

// Entity — identity via UserId
class User {
  private constructor(
    public readonly id: UserId,
    private email: EmailAddress,
    private passwordHash: PasswordHash,
    private role: RoleName,
    private active: boolean,
  ) {}

  static rehydrate(state: UserState): User { /* from repo */ }

  changeEmail(next: EmailAddress): DomainEvent[] {
    if (next === this.email) return [];
    this.email = next;
    return [new UserEmailChanged(this.id, next)];
  }
}
```

## Anti-Patterns to Avoid

- **Primitive obsession.** Passing `string` for `userId`, `email`,
  and `templateKey` lets the compiler shrug when you swap them.
  Wrap them.
- **Public setters on entities.** Entities mutate through methods,
  not setters.
- **Logic in DTOs.** DTOs (request/response shapes) are dumb; the
  domain decides.
