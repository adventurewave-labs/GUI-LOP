# Subdomain Classification

DDD distinguishes three kinds of subdomains based on the value they
provide to the business. The classification drives investment: we
build the **core**, integrate the **supporting**, and buy or
delegate the **generic**.

## Core Subdomain

> Where the platform's competitive value lives. Build it ourselves
> and invest disproportionately.

### Workflow Orchestration & Human-in-the-Loop

This is the heart of GUI-LOP. The differentiating capability is the
durable, observable, auditable coordination of automated and human
steps in a single workflow. Specifically:

- The Workflow lifecycle and step semantics.
- The HITL coordination protocol (pause, notify, generate, respond,
  resume).
- Deadlines, escalation, and idempotent responses.

We invest the most modelling effort here. Tactical DDD (aggregates,
domain events, invariants) is applied rigorously. Bounded contexts
*Workflow Orchestration* and *Human Interaction* belong here.

## Supporting Subdomains

> Necessary for the core to function but not differentiating. Build
> only what is needed; reuse community/vendor solutions where
> possible.

### Identity & Access

User accounts, sessions, JWTs, RBAC. Necessary because workflows
are sensitive, but our identity model is conventional. We
implement it ourselves but borrow heavily from community libraries
(`bcrypt`, JWT libs). Future: integrate with an external IdP
(OAuth2/OIDC).

### UI Generation

Translating a UI specification + workflow context into a renderable
UI. Necessary because human steps require interaction, but the
generation logic is template-and-rules driven, not novel.

### Notification & Realtime

Pushing events to subscribed clients (WebSocket, email, webhook).
Necessary because users must know when their input is needed; the
mechanics are conventional pub/sub fan-out.

## Generic Subdomains

> Solved problems with mature solutions. Buy, borrow, or delegate.

### Audit & Analytics

Append-only event and audit logs, dashboards, and reporting. We
adopt standard tools (Prometheus, OpenTelemetry, Grafana,
Postgres views) rather than build our own.

### Persistence

Postgres + Redis. We use them as-is and do not pretend our
repositories are interesting domain logic.

### Operations & Deployment

Docker, Kubernetes, secrets management, CI/CD. Standard.

### Security Plumbing

TLS, rate limiting, input validation, CORS, password hashing. We
follow OWASP guidance and use established libraries.

## Investment Heuristic

| Subdomain                           | Class       | Investment       |
| ----------------------------------- | ----------- | ---------------- |
| Workflow Orchestration              | Core        | High             |
| Human-in-the-Loop Coordination      | Core        | High             |
| Identity & Access                   | Supporting  | Medium           |
| UI Generation                       | Supporting  | Medium           |
| Notification & Realtime             | Supporting  | Medium           |
| Audit & Analytics                   | Generic     | Low (configure)  |
| Persistence (Postgres, Redis)       | Generic     | Low (operate)    |
| Operations & Deployment             | Generic     | Low (operate)    |
| Security Plumbing                   | Generic     | Low (configure)  |

> "High" means we use full tactical DDD, write our own model, and
> have multiple tests per behaviour. "Medium" means we model
> carefully but lean on libraries. "Low" means we configure
> proven tools.
