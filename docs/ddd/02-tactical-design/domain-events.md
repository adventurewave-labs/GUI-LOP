# Domain Events

A **domain event** is an immutable, named fact about something that
has already happened in the domain. Events are the primary mechanism
for cross-aggregate and cross-context coordination (see ADR 0014 —
Outbox).

## Anatomy

Every event carries:

- `event_id` (`UUID`) — unique identifier; used for idempotency by
  consumers.
- `event_type` (`<context>.<aggregate>.<verb>`) — e.g.
  `workflow_orchestration.workflow.completed`.
- `event_version` (`integer`) — schema version. Additive changes
  bump nothing; breaking changes bump and old subscribers continue
  to receive the previous version until upgraded.
- `occurred_at` (`Timestamp`) — when the fact became true in the
  domain (not necessarily when it was published).
- `aggregate_id` (`UUID`) — id of the aggregate that produced it.
- `aggregate_type` (`string`) — e.g. `Workflow`, `HumanResponse`.
- `correlation_id` (`UUID`) — request id propagated for tracing.
- `causation_id` (`UUID`, optional) — id of the prior event that
  caused this one.
- `actor` — `{ user_id?, session_id?, system?: true }`.
- `payload` — domain-specific data (see catalogue).

Events are *facts*, not commands. They are named in the past tense
and they cannot be vetoed.

## Catalogue

### Workflow Orchestration

| Event                                    | Payload                                    | Triggered When                              |
| ---------------------------------------- | ------------------------------------------ | ------------------------------------------- |
| `workflow.created`                       | `{ template_key, version, context }`       | A new workflow instance is created.         |
| `workflow.started`                       | `{ workflow_id, started_at }`              | Engine begins execution.                    |
| `workflow.step_started`                  | `{ workflow_id, step_id, step_name }`      | A step transitions to `running`.            |
| `workflow.step_completed`                | `{ workflow_id, step_id, output }`         | A step transitions to `completed`.          |
| `workflow.step_failed`                   | `{ workflow_id, step_id, error }`          | A step fails.                               |
| `workflow.human_input_required`          | `{ workflow_id, step_id, ui_spec }`        | Engine pauses on a human step.              |
| `workflow.completed`                     | `{ workflow_id, completed_at, result }`    | Workflow reaches `completed`.               |
| `workflow.failed`                        | `{ workflow_id, reason }`                  | Workflow reaches `failed`.                  |
| `workflow.cancelled`                     | `{ workflow_id, by, reason }`              | An admin cancels a workflow.                |
| `template.published`                     | `{ template_key, version }`                | A template version is published.            |
| `template.deprecated`                    | `{ template_key, version }`                | A template version is deprecated.           |

### Human Interaction

| Event                                    | Payload                                    | Triggered When                              |
| ---------------------------------------- | ------------------------------------------ | ------------------------------------------- |
| `human_response.recorded`                | `{ workflow_id, step_id, action, payload, by }` | A response is durably persisted.       |
| `human_step.escalated`                   | `{ workflow_id, step_id, level, reason }`  | A pending step is escalated.                |
| `human_step.deadline_passed`             | `{ workflow_id, step_id, policy }`         | A pending step's deadline elapses.          |

### Identity & Access

| Event                                    | Payload                                    | Triggered When                              |
| ---------------------------------------- | ------------------------------------------ | ------------------------------------------- |
| `user.registered`                        | `{ user_id, email }`                       | A new user is created.                      |
| `user.authenticated`                     | `{ user_id, session_id, ip }`              | A login succeeds.                           |
| `user.authentication_failed`             | `{ email_or_username, ip, reason }`        | A login attempt fails.                      |
| `user.deactivated`                       | `{ user_id }`                              | A user is disabled.                         |
| `session.refreshed`                      | `{ session_id, user_id }`                  | A refresh token is exchanged.               |
| `session.revoked`                        | `{ session_id, user_id }`                  | A session is invalidated.                   |
| `role.granted`                           | `{ user_id, role }`                        | A role is assigned.                         |
| `permission.granted`                     | `{ user_id, permission, scope? }`          | A scoped permission is granted.             |
| `permission.revoked`                     | `{ user_id, permission, scope? }`          | A scoped permission is revoked.             |

### UI Generation

| Event                                    | Payload                                    | Triggered When                              |
| ---------------------------------------- | ------------------------------------------ | ------------------------------------------- |
| `ui.generated`                           | `{ workflow_id, step_id, ui_document_id, url }` | A UI document is produced.            |
| `ui.generation_failed`                   | `{ workflow_id, step_id, reason }`         | UI generation fails.                        |

### Notification & Realtime

| Event                                    | Payload                                    | Triggered When                              |
| ---------------------------------------- | ------------------------------------------ | ------------------------------------------- |
| `notification.delivered`                 | `{ subscription_id, event_type, channel, attempt }` | A notification is acknowledged.   |
| `notification.failed`                    | `{ subscription_id, event_type, channel, reason }` | Final delivery failure.            |

## Naming Conventions

- `<aggregate>.<verb>` (past tense). The aggregate is implied by
  context if unambiguous; for cross-context publishing, the
  `<context>.<aggregate>.<verb>` form is used.
- Verbs: `created`, `started`, `completed`, `failed`, `cancelled`,
  `revoked`, `granted`. Use the closest one in the ubiquitous
  language.
- Avoid `updated` — be specific about what changed
  (`status_changed`, `email_changed`).

## Storage and Delivery

- Events are written to the `events` table inside the same
  transaction as the aggregate change.
- The transactional outbox (ADR 0014) publishes them to:
  - the in-process bus (synchronous handlers, e.g. read-model
    updates),
  - Redis Pub/Sub (multi-instance fan-out),
  - external sinks (email, webhooks) via the Notification context.
- Consumers must be idempotent (use `event_id`).

## Versioning

- Additive changes (new optional fields) do not bump version.
- Breaking changes (rename, remove, semantic change) require a new
  event type or an explicit version bump and dual-publish for one
  major release.

## Schemas and Contracts

- Each event type has a JSON Schema in
  `src/backend/contexts/<context>/domain/events/`.
- Contract tests verify that producers and consumers agree on the
  schema for each version.
- The schema registry is the source of truth; documentation is
  generated from it.

## Anti-Patterns to Avoid

- **Commands disguised as events.** `WorkflowShouldComplete` is not
  an event. Prefer a use case that completes the workflow and emits
  `workflow.completed`.
- **Fat events** carrying entire aggregate snapshots. Carry the id
  and the changed fields; consumers query if they need more.
- **Mutable events.** Events do not change after publication. Errors
  are corrected by emitting *new* events.
