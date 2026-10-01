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

### Migration policy: forward-only

- **There are no down migrations.** A bad release is rolled back by redeploying the previous image;
  the schema stays where it is. That only works if every migration is **backwards compatible with
  the previous release** (expand → migrate → contract, as above): additive changes first, removals
  one release later.
- **Idempotent.** Every migration can be re-run safely (`IF NOT EXISTS`, guarded `DO` blocks,
  `ON CONFLICT`); CI applies the full set twice against an empty database on every change.
- **Never edit an applied migration.** Add a new numbered file instead; the ledger is the
  `schema_migrations` table.
- **Take a backup before a release that contains a migration** (`npm run db:backup`). The restore is
  the only "down".
- Migrations run outside the app's pool (no statement timeout — index builds may legitimately be
  slow). On Railway they are the service's pre-deploy command; on Kubernetes the Helm hook above.

### Backups, restore and the restore drill

One script, driven by `DATABASE_URL` (`database/scripts/db-backup.sh`; client tools must be at
least as new as the server):

```bash
npm run db:backup                               # → backups/gui-lop-<UTC>.dump (+ .sha256), prunes > 30 days
npm run db:verify  -- backups/gui-lop-….dump    # checksum + archive readable
npm run db:restore -- backups/gui-lop-….dump "$TARGET_DATABASE_URL"   # empty target only; one transaction
npm run db:drill                                # dump → restore to scratch DB → compare → drop
```

- `restore` refuses a target that already has tables (`FORCE=1` overrides) and runs in a single
  transaction, so a failed restore leaves nothing half-applied.
- `drill` is the proof that backups work: it restores into a scratch database on the same server,
  compares **every table's row count** with the source, checks the migration ledger, runs the
  migrations against the copy (must be a no-op) and prints dump size and timings. CI runs it after
  the production smoke test and then boots the API on nothing but the restored copy.
- Reference timing (2026-10-01, 22 tables / 76k rows / 3.6 MB dump): backup 0.6 s, restore 0.8 s.
  Re-measure on production data; that restore time plus redeploy is your RTO, and your backup
  frequency is your RPO. On a live source use `DRILL_STRICT=0` (counts may drift during the dump).
- **Restore procedure (incident):** 1) stop writers (scale the API to 0); 2) create an empty
  database; 3) `db:restore` the newest verified dump into it; 4) point `DATABASE_URL` at it and
  deploy (pre-deploy migrations bring it to the current schema); 5) run `scripts/smoke.mjs`;
  6) Redis needs no restore — sessions re-authenticate and rate-limit counters reset.
- Managed Postgres (Railway volume backups, RDS snapshots) is the first line; this script is the
  portable, verifiable second line and the only one exercised in CI.

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

### What production refuses to start with

With `NODE_ENV=production` the config loader fails at boot (listing every problem at once, never
echoing a value) instead of running insecurely or losing data quietly:

| Setting | Refused when |
| --- | --- |
| `NODE_ENV` | not exactly `development`, `test` or `production` (a typo such as `prod` used to run in non-production mode) |
| `JWT_SECRET` | shorter than 32 characters, a documentation placeholder (`change-me…`, `your-…`, `ci-…`), or low entropy |
| `DATABASE_URL`, `REDIS_URL` | missing — unless `ALLOW_EPHEMERAL_STATE=true` (throw-away containers only: data is lost on restart, logout and rate limits are per-process) |
| `CORS_ORIGINS` | contains `*` or `null` (the API allows credentials) |
| `BCRYPT_WORK_FACTOR` | outside 10–15 |
| `METRICS_TOKEN` | set but shorter than 16 characters (unset = `/metrics` answers 404) |
| `JWT_ACCESS_TTL_SECONDS` | outside 60–3600; `JWT_REFRESH_TTL_SECONDS` not longer than it |
| `AI_PROVIDER` ≠ `stub` | `AI_API_KEY` missing |
| rate limits | any of `RATE_LIMIT_MAX`, `AUTH_LOGIN_IP_LIMIT`, `AUTH_REGISTER_IP_LIMIT` is 0 |
| `WS_ALLOW_HEADER_AUTH` | `true` |

Allowed but logged as `config:` warnings at boot: `TRUST_PROXY=true` or `false`, `LOG_LEVEL=debug`,
no `METRICS_TOKEN`, plain-http or localhost CORS origins, `AI_PROVIDER=stub`, `ALLOW_EPHEMERAL_STATE=true`.
`.env.example` documents every setting and is checked against the schema in CI.

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

## Performance: SLOs, baseline and load testing

**Service-level objectives** (per API instance, measured at the server; alert rules follow in the runbook):

| Objective | Target |
| --- | --- |
| API latency (all `/api/v1` routes except login) | p95 < 250 ms, p99 < 600 ms |
| Login latency (bcrypt cost 12, by design CPU-bound) | p95 < 800 ms |
| Error rate (5xx + timeouts) | < 0.1 % |
| Liveness / readiness probes | p99 < 50 ms |
| Outbox delivery lag (`outbox_oldest_pending_age_seconds`) | < 30 s |

**Baseline** — 2026-10-01, `NODE_ENV=production`, one API process, Postgres 16 + Redis on the same
2-vCPU sandbox as the load generator (so these are conservative), 20 closed-loop virtual users, 15 s:

| Scenario | Throughput | p50 | p95 | p99 | Errors |
| --- | --- | --- | --- | --- | --- |
| `health` — `GET /livez` | 4 631 req/s | 3.1 ms | 10.3 ms | 15.3 ms | 0 |
| `read` — `GET /workflows/:id` (auth + 2 DB round-trips) | 1 381 req/s | 13.6 ms | 22.2 ms | 29.1 ms | 0 |
| `write` — `POST /workflows` (txn + steps + outbox, ~5 round-trips) | 450 req/s | 43.5 ms | 58.9 ms | 70.1 ms | 0 |
| `mixed` — 70 % read · 20 % templates · 10 % write | 1 048 req/s | 16.2 ms | 42.7 ms | 55.1 ms | 0 |

Unloaded single-request latency: read 1.8 ms, write 4 ms. Under 20 users the process is CPU-bound,
not waiting on the database (pool never queued), so the first scaling lever is replicas, then
`DB_POOL_MAX`. A login flood from one IP is absorbed by the auth limiter (300/min per IP): 2 575 req/s
answered with 429 at p99 11 ms without reaching bcrypt. Legitimate login capacity is bounded by
bcrypt: ~250 ms of CPU each, i.e. roughly 4 logins/s per core.

**Run it** (`scripts/load.mjs`, no dependencies; exits non-zero when an SLO is missed):

```bash
# The default 600 req/min per-IP budget would turn a load run into a 429 test.
RATE_LIMIT_MAX=100000000 NODE_ENV=production ... node src/backend/bootstrap/index.js &
node scripts/load.mjs --base http://localhost:3001 --scenario mixed \
  --concurrency 20 --duration 20 --p95 250 --p99 600 --max-error-rate 0.001
```

CI runs a short `mixed` pass after the production-mode smoke test as a regression tripwire (generous
thresholds: shared runners are noisy). Do not point a real load run at staging without raising its
`RATE_LIMIT_MAX` first.

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
