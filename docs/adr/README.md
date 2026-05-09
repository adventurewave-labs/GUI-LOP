# Architecture Decision Records (ADRs)

This directory contains Architecture Decision Records for the GUI-LOP
(Generative UI & Human-in-the-Loop Orchestration Platform) project.

## What is an ADR?

An Architecture Decision Record (ADR) captures a single, important
architectural decision, the context in which it was made, the alternatives
considered, and the consequences. ADRs are immutable once accepted; if a
decision changes, a new ADR is created that supersedes the prior one.

We follow the format proposed by Michael Nygard, lightly extended.

## How to Use This Directory

1. To propose a new decision, copy `0000-template.md` to a new file using
   the next available four-digit prefix and a short kebab-case slug, e.g.
   `0023-adopt-grpc-for-internal-services.md`.
2. Set status to `Proposed`. Open a pull request for review.
3. Once approved, change status to `Accepted` and merge.
4. If the decision is later changed, create a new ADR with status
   `Accepted` and link it from a new `Superseded by` line at the top of the
   old one. Do not delete or rewrite history.

## Status Values

- **Proposed** — under review, not yet ratified
- **Accepted** — current binding decision
- **Deprecated** — no longer recommended, but still in use somewhere
- **Superseded by NNNN** — replaced by a newer ADR

## Index

| #    | Title                                                       | Status   |
| ---- | ----------------------------------------------------------- | -------- |
| 0001 | Record Architecture Decisions                               | Accepted |
| 0002 | Use Node.js and Express for Backend                         | Accepted |
| 0003 | Adopt Domain-Driven Design                                  | Accepted |
| 0004 | Hexagonal (Ports & Adapters) Architecture                   | Accepted |
| 0005 | Event-Driven Real-Time Communication via WebSockets         | Accepted |
| 0006 | PostgreSQL as Primary System of Record                      | Accepted |
| 0007 | Redis for Caching, Sessions, and Pub/Sub                    | Accepted |
| 0008 | JWT-Based Authentication with Refresh Tokens                | Accepted |
| 0009 | Role-Based Access Control with Resource-Scoped Permissions  | Accepted |
| 0010 | React Single-Page Application for the Frontend              | Accepted |
| 0011 | Template-Driven Workflow Definition Model                   | Accepted |
| 0012 | Human-in-the-Loop Coordination Protocol                     | Accepted |
| 0013 | CQRS Lite for Workflow Reads and Writes                     | Accepted |
| 0014 | Transactional Outbox for Domain Events                      | Accepted |
| 0015 | Rate Limiting Strategy                                      | Accepted |
| 0016 | Audit Logging and Append-Only Event Trail                   | Accepted |
| 0017 | URL-Based API Versioning                                    | Accepted |
| 0018 | Monorepo and Module Structure                               | Accepted |
| 0019 | Layered Testing Strategy                                    | Accepted |
| 0020 | Containerised Deployment with Docker and Kubernetes         | Accepted |
| 0021 | Observability: Logs, Metrics, Traces                        | Accepted |
| 0022 | Configuration and Secrets Management                        | Accepted |
| 0023 | Anti-Corruption Layer for External AI Providers             | Accepted |
| 0024 | Idempotency for Workflow Mutating Endpoints                 | Accepted |

## Related Documentation

- [Domain-Driven Design Documentation](../ddd/README.md)
- [Architecture Overview](../ARCHITECTURE.md)
