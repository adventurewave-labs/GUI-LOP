# GUI-LOP Production Deployment Guide

This guide covers the production deploy story for the **DDD bootstrap** of
GUI-LOP. Entry point: `src/backend/bootstrap/index.js`. See ADRs
[0020](./adr/0020-docker-and-kubernetes.md),
[0021](./adr/0021-observability.md), and
[0022](./adr/0022-configuration-and-secrets.md) for the underlying
decisions.

> Looking for the legacy simple-server deploy guide? It's still in
> `PRODUCTION_DEPLOYMENT_GUIDE.md` at the repo root. Both will live side by
> side until the legacy server is retired.

---

## Table of contents

1. [Prerequisites](#prerequisites)
2. [Local development with docker-compose](#local-development-with-docker-compose)
3. [Building and tagging an image](#building-and-tagging-an-image)
4. [Deploying via Helm](#deploying-via-helm)
5. [Schema migrations during a rollout](#schema-migrations-during-a-rollout)
6. [Secrets handling](#secrets-handling)
7. [Rollback runbook](#rollback-runbook)
8. [CI/CD reference](#cicd-reference)

---

## Prerequisites

| Tool   | Version       | Notes |
|--------|---------------|-------|
| Node   | 18.x          | matches the runtime image |
| Docker | 24+           | optional locally; required in CI |
| Helm   | 3.12+         | for chart linting and deploys |
| `kubectl` | matches cluster | for `helm` and rollback ops |

A populated `.env` (copy `.env.example`) is required for compose. **Never
commit a real `.env`** — see ADR 0022.

---

## Local development with docker-compose

```bash
cp .env.example .env       # then fill in JWT_SECRET (required)
docker compose up --build  # postgres + redis + app, all wired up
```

The `app` service runs `infrastructure/scripts/start-with-migrations.sh`,
which:

1. Runs `node database/migrations/migrate.js migrate` against
   `DATABASE_URL` (skipped automatically when the variable is empty).
2. Execs `node src/backend/bootstrap/index.js`.

Verify:

```bash
curl -fsS http://localhost:3001/health | jq
# {
#   "status": "ok",
#   "subsystems": { "db": "ok", "redis": "ok", "outbox_lag": "unknown" }
# }
```

Stop and remove volumes:

```bash
docker compose down -v
```

---

## Building and tagging an image

The root `Dockerfile` is multi-stage, alpine-based, runs as the built-in
`node` user, and exposes a `HEALTHCHECK` against `/health` (ADR 0020).

```bash
# Build with the npm helper:
npm run docker:build           # → gui-lop:local

# Or directly, with an immutable :git-sha tag:
docker build -t gui-lop:$(git rev-parse --short HEAD) .

# Smoke-test locally without a database (in-memory adapters):
npm run docker:run             # then curl http://localhost:3001/health
```

For production, push to your registry under both `:env-prod` (rolling) and
`:<git-sha>` (immutable) tags. The reference workflow lives at
`.github/workflows/docker.yml`; the registry-push step is currently
commented out — wire it up once registry credentials are provisioned.

---

## Deploying via Helm

The chart lives at `infrastructure/helm/gui-lop/`. Lint it locally first:

```bash
npm run helm:lint
# ==> Linting infrastructure/helm/gui-lop
# 1 chart(s) linted, 0 chart(s) failed
```

Render to inspect what will be applied:

```bash
helm template gui-lop infrastructure/helm/gui-lop \
  -f infrastructure/helm/gui-lop/values.yaml \
  --set image.tag=$(git rev-parse --short HEAD) \
  --set secrets.JWT_SECRET=$(openssl rand -base64 64)
```

Install or upgrade against a namespace:

```bash
kubectl create namespace gui-lop --dry-run=client -o yaml | kubectl apply -f -

helm upgrade --install gui-lop infrastructure/helm/gui-lop \
  --namespace gui-lop \
  --set image.repository=ghcr.io/your-org/gui-lop \
  --set image.tag=$(git rev-parse --short HEAD) \
  --set secrets.create=false \
  --set secrets.existingSecretName=gui-lop-secrets \
  --wait --timeout 10m
```

Expected output ends with:

```
NAME: gui-lop
STATUS: deployed
REVISION: <n>
```

Verify:

```bash
kubectl -n gui-lop get pods,svc
kubectl -n gui-lop port-forward svc/gui-lop 3001:3001 &
curl -fsS http://localhost:3001/health
```

### Important values

| Key | Default | Meaning |
|-----|---------|---------|
| `replicaCount` | 2 | API pods |
| `image.repository` / `image.tag` | `ghcr.io/your-org/gui-lop:latest` | per-env override required |
| `resources.requests` | 200m CPU / 256Mi mem | per pod |
| `resources.limits` | 1 CPU / 512Mi mem | per pod |
| `autoscaling.enabled` | `false` | enable HPA targeting CPU 70% |
| `ingress.enabled` | `false` | optional Ingress |
| `migrations.enabled` | `true` | pre-install/pre-upgrade Job |
| `secrets.create` | `true` | for prod, set to `false` and provide `existingSecretName` |
| `pdb.enabled` / `pdb.minAvailable` | `true` / 1 | maintain availability during voluntary disruptions |
| `terminationGracePeriodSeconds` | 30 | matches ADR 0020 drain budget |

---

## Schema migrations during a rollout

Migrations are applied by a Helm pre-install/pre-upgrade `Job`
(`infrastructure/helm/gui-lop/templates/migration-job.yaml`). On every
`helm upgrade`:

1. The Job runs `node database/migrations/migrate.js migrate` against the
   in-cluster Secret's `DATABASE_URL`.
2. The Job must succeed before any new API pod is rolled out.
3. The Job is named per release revision and cleaned up by the
   `before-hook-creation,hook-succeeded` hook policy.

Watch progress:

```bash
kubectl -n gui-lop get jobs -w
kubectl -n gui-lop logs -l app.kubernetes.io/component=migrate -f
```

If the Job fails, the deploy halts before any pod with the new image
serves traffic. Roll forward by fixing the migration and re-running
`helm upgrade`, or roll back (next section).

> Backwards-incompatible schema changes should follow the
> expand → migrate → contract pattern (add column, dual-write,
> back-fill, then remove old column in a follow-up release).

---

## Secrets handling

| Environment | Source                                     |
|-------------|--------------------------------------------|
| Local dev   | `.env` (gitignored), values inlined into compose |
| In-cluster (kind/minikube) | chart-generated `Secret` (`secrets.create: true`) |
| Staging / Prod | external-secrets-operator / sealed-secrets / Vault sidecar |

Production checklist (ADR 0022):

- [ ] `secrets.create: false` in the per-env values file.
- [ ] A pre-existing `Secret` (or `ExternalSecret`) named via
      `secrets.existingSecretName` carries `JWT_SECRET`, `DATABASE_URL`,
      `REDIS_URL`.
- [ ] No secret literal anywhere in git, including overlay values files.
- [ ] Rotation runbook in place. The bootstrap re-reads env on restart,
      so a rolling restart is sufficient after rotating a Secret.

---

## Rollback runbook

### A. Roll back the application

```bash
# Inspect history
helm -n gui-lop history gui-lop

# Roll back to the previous successful revision
helm -n gui-lop rollback gui-lop <REVISION> --wait --timeout 10m

# Confirm
kubectl -n gui-lop get pods -l app.kubernetes.io/component=api
curl -fsS https://<your-host>/health
```

### B. Roll back a migration

If the bad release added a non-reversible migration, take the safer path:

1. Disable autoscaling (`kubectl scale deploy gui-lop --replicas=2`).
2. Apply a forward-fix migration that adds a compatibility shim instead
   of reverting.
3. Re-roll.

For a reversible migration with a documented `down`, run it manually
against the production DB **with a maintenance window**:

```bash
kubectl -n gui-lop run migrate-down --rm -it --restart=Never \
  --image=ghcr.io/your-org/gui-lop:<previous-sha> \
  --env="DATABASE_URL=$(kubectl -n gui-lop get secret gui-lop-secrets -o jsonpath='{.data.DATABASE_URL}' | base64 -d)" \
  -- node database/migrations/migrate.js rollback
```

### C. Roll back the Docker image only

```bash
helm -n gui-lop upgrade gui-lop infrastructure/helm/gui-lop \
  --reuse-values \
  --set image.tag=<previous-sha> \
  --wait
```

---

## CI/CD reference

| Workflow | Trigger | Gate? |
|----------|---------|-------|
| `.github/workflows/ci.yml` | every PR + `main` + `claude/**` | **required** |
| `.github/workflows/arch-lint.yml` | every PR + `main` | **required** |
| `.github/workflows/docker.yml` | push to `main` | informational (build + healthcheck smoke) |
| `.github/workflows/bench.yml` | push to `main` | informational (artifact only) |

`ci.yml` runs `npm run typecheck` followed by:

```bash
npx jest --config jest.backend.config.js \
  src/backend/ \
  tests/backend/contexts/ \
  tests/integration/bootstrap-smoke.test.js
```

`bench.yml` uploads `tests/benchmarks/results/latest.json` and
`latest.md` as a build artifact for trend tracking.

---

## Where things live

```
Dockerfile                                      # multi-stage, alpine, non-root
docker-compose.yml                              # local dev stack
.env.example                                    # config schema, copy to .env
infrastructure/
  helm/gui-lop/
    Chart.yaml
    values.yaml
    templates/_helpers.tpl
    templates/configmap.yaml
    templates/secret.yaml
    templates/deployment.yaml
    templates/service.yaml
    templates/ingress.yaml
    templates/migration-job.yaml                # pre-install/pre-upgrade
    templates/hpa.yaml                          # behind autoscaling.enabled
    templates/pdb.yaml
    templates/serviceaccount.yaml
  scripts/start-with-migrations.sh              # used by docker-compose
.github/workflows/
  ci.yml
  arch-lint.yml
  docker.yml
  bench.yml
```
