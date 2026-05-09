# 0020. Containerised Deployment with Docker and Kubernetes

- **Status:** Accepted
- **Date:** 2025-10-26
- **Deciders:** Platform / DevOps team
- **Tags:** deployment, docker, k8s

## Context

The platform must run identically on developer laptops, CI, staging,
and production, and scale horizontally with predictable behaviour.
The repository already includes `docker-compose.{yml,dev.yml,staging.yml}`
and a `docker/` directory with environment-specific configs.

## Decision

- **Local & CI**: Docker Compose runs the full stack (backend,
  frontend dev server, Postgres, Redis, optional outbox publisher).
- **Staging & Production**: Kubernetes is the target orchestrator.
  The backend ships as one or more Deployments behind a Service and
  Ingress; the frontend is built to static files and served by a CDN
  or NGINX.
- **Image policy**:
  - Multi-stage builds with `node:18-alpine` base.
  - Non-root user; read-only root filesystem where feasible.
  - Images tagged `:<git-sha>` (immutable) and `:env-{staging,prod}`
    (rolling).
- **Configuration**: 12-factor environment variables, with secrets
  injected from a secrets manager (ADR 0022).
- **Health endpoints**: `/health` for liveness; `/health/ready`
  reports DB, Redis, outbox lag for readiness.
- **Graceful shutdown**: SIGTERM → drain HTTP, close WebSockets with
  a `1001` going-away frame, finish in-flight outbox dispatches,
  exit. Default Kubernetes `terminationGracePeriodSeconds: 30`.

## Alternatives Considered

- **Bare VMs / systemd** — lower abstraction, more bespoke; rejected
  for the production target.
- **Serverless (Lambda)** — incompatible with long-lived WebSocket
  connections without a separate gateway; rejected for the main
  service. Could host helpers (e.g. notifiers).
- **Nomad / ECS** — viable; rejected to standardise on Kubernetes
  given existing platform expertise.

## Consequences

### Positive

- Identical artefacts across environments.
- Rolling deploys, autoscaling, self-healing pods.
- Standard ecosystem for operators and tooling.

### Negative / Trade-offs

- Kubernetes raises the operational bar; mitigated by managed
  control planes (EKS/GKE/AKS).
- Stateful WebSockets need careful drain handling; covered by the
  shutdown protocol and the Redis pub/sub fan-out (ADR 0007).

### Neutral

- The same Helm chart deploys to staging and production with
  per-environment values.

## Compliance and Verification

- Health endpoints are smoke-tested on every deploy.
- Image vulnerability scanning runs on every build.
- A periodic chaos test kills random pods to validate resiliency.

## References

- `docker/`, `docker-compose*.yml`
- `infrastructure/`
- `docs/PRODUCTION_DEPLOYMENT_GUIDE.md`
