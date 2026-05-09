# Context Map

The context map shows the relationships between bounded contexts:
who depends on whom, what kind of relationship it is, and how
translation happens between models.

## Diagram

```
┌─────────────────────────────────┐                 ┌────────────────────────────┐
│  Workflow Orchestration  (CORE) │ ──── publishes ──▶ │  Notification & Realtime   │
│                                 │   domain events    │   (Customer/Supplier)      │
│  • Workflow                     │                 │                            │
│  • WorkflowTemplate             │                 └────────────────────────────┘
│  • Engine                       │                            │
└──────┬────────────┬─────────────┘                            │ pushes
       │            │                                          ▼
       │ asks       │ asks                              ┌──────────────┐
       │ "is        │ "render UI                        │   Clients    │
       │ allowed?"  │ for step"                         │ (browser, …) │
       ▼            ▼                                   └──────────────┘
┌────────────────┐ ┌─────────────────┐                         ▲
│  Identity      │ │  UI Generation  │                         │
│  & Access      │ │  (Conformist /  │                         │
│  (Conformist)  │ │   Customer)     │                         │
└────────────────┘ └─────────────────┘                         │
       ▲                                                       │
       │ authenticates                                         │
       │                                                       │
┌──────┴──────────────────────────────────────────────────────┐│
│                          HTTP / WebSocket                    │
└──────────────────────────────────────────────────────────────┘
       ▲
       │ submits responses
       │
┌──────┴──────────┐                            ┌─────────────────────────────┐
│   Human         │ ─────── publishes ───────▶ │   Audit & Analytics         │
│   Interaction   │     human-response         │   (Conformist / Read-Only)  │
│   (CORE)        │       events               │                             │
└──────┬──────────┘                            └─────────────────────────────┘
       │
       │ informs of response
       ▼
┌─────────────────────────────────┐
│  Workflow Orchestration         │
└─────────────────────────────────┘
```

## Relationship Types

We use the standard DDD vocabulary. Each edge below is read
"upstream → downstream".

### Workflow Orchestration → Notification & Realtime
**Customer / Supplier.** Workflow Orchestration is the supplier of
domain events; Notification is the customer. They negotiate the
event contract jointly. Notification *conforms* to the supplied
event shapes through a published, versioned event schema.

### Workflow Orchestration → Identity & Access
**Conformist (light).** Orchestration calls Identity for
authorisation decisions. Identity owns the model; Orchestration
adapts to it. The relationship is read-only and synchronous.

### Workflow Orchestration → UI Generation
**Customer / Supplier.** When a human step is reached, Orchestration
asks UI Generation for a UI document. The contract is a small,
stable port (`generateForStep(stepId, spec, ctx)`); UI Generation
internals can change freely.

### Human Interaction ↔ Workflow Orchestration
**Partnership.** These two contexts are co-evolved. A human response
is recorded by Human Interaction, which then notifies Orchestration
to advance the workflow. Both teams agree on the shared aggregate
boundary: the *workflow* is owned by Orchestration; the *response*
is owned by Human Interaction; the link is the workflow id and step
id.

### Workflow Orchestration → Audit & Analytics
**Open-Host Service / Conformist.** Orchestration publishes events
through the outbox; Audit & Analytics consumes them to build read
models. Audit conforms to whatever Orchestration publishes; the
bus is the integration contract.

### Human Interaction → Audit & Analytics
Same pattern as above: published events feed read models.

### Identity & Access → Audit & Analytics
Same pattern: login, role-grant, permission-check events feed audit
trails.

## Cross-Context Communication Patterns

### Synchronous, in-process port
Used for the few cases where a synchronous answer is required:

- `IsAuthorised(userId, action, resource)` — Orchestration → Identity.
- `GenerateUI(spec, ctx)` — Orchestration → UI Generation.

These are exposed as TypeScript interfaces in the application layer
of the *consuming* context. The supplying context provides an
implementation registered in the composition root. No HTTP, no
serialisation.

### Asynchronous, via domain events
Used for everything else:

- `WorkflowCreated`, `WorkflowStarted`, `WorkflowCompleted`,
  `WorkflowFailed` — published by Orchestration.
- `HumanInputRequired`, `HumanResponseRecorded` — published by
  Human Interaction.
- `UIGenerated` — published by UI Generation.
- `UserAuthenticated`, `RoleGranted` — published by Identity.

Events flow through the transactional outbox (ADR 0014) and are
delivered to subscribers via the in-process bus and Redis Pub/Sub.

### No shared database tables across contexts
Each context owns its tables. Where another context needs read
access, it subscribes to events and maintains its own projection.
The exception is the shared `users.id` foreign key, which is part
of the shared kernel.

## Anti-Corruption Layers

We deploy ACLs (ADR 0023) at boundaries with external systems whose
models are messy or volatile:

- AI providers (OpenAI, Anthropic, etc.) — behind UI Generation and
  Workflow Orchestration as appropriate.
- Email and webhook providers — behind Notification.
- External IdPs (when added) — behind Identity & Access.

The ACL is a thin module per integration: it exposes domain types
inward and translates to vendor types outward. Vendor-specific
errors are mapped to domain errors.

## Versioning and Change Discipline

- **Internal events**: change with the producing context. Consumers
  must support the latest one major version.
- **Public APIs (REST/WebSocket)**: versioned per ADR 0017.
- **Cross-context interfaces**: changes require a PR that updates
  both producer and consumer; a deprecation note must accompany
  removals.

## Summary Table

| Upstream                | Downstream            | Pattern                | Channel              |
| ----------------------- | --------------------- | ---------------------- | -------------------- |
| Workflow Orchestration  | Notification          | Customer/Supplier      | Domain events        |
| Workflow Orchestration  | Identity & Access     | Conformist             | Sync port            |
| Workflow Orchestration  | UI Generation         | Customer/Supplier      | Sync port            |
| Workflow Orchestration  | Audit & Analytics     | Open-Host / Conformist | Domain events        |
| Human Interaction       | Workflow Orchestration | Partnership           | Sync port + events   |
| Human Interaction       | Audit & Analytics     | Open-Host / Conformist | Domain events        |
| Identity & Access       | Audit & Analytics     | Open-Host / Conformist | Domain events        |
| Notification            | Browser clients       | Open-Host (WS API)     | WebSocket envelope   |
