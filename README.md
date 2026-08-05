# GUI-LOP: Generative UI & Human-in-the-Loop Orchestration Platform

A platform for orchestrating workflows that interleave automated steps with
human decision points. Built as a domain-driven backend (6 bounded
contexts, hexagonal architecture, transactional outbox) with a React SPA
and a WebSocket-based real-time channel.

- **Backend:** Node.js 18+, Express, WebSocket (`ws`), Postgres + Redis
  (with in-memory fall-backs for dev), JWT auth, OpenAI/Anthropic ACL.
- **Frontend:** React 18 SPA at `src/frontend/`.
- **Status:** 560 backend tests passing across 75 suites; 25/25 SLO
  benchmarks PASS; six bounded contexts wired through one bootstrap
  composition root.

For the why and how, read:

- [`docs/MISSION_REPORT_DDD_MIGRATION.md`](docs/MISSION_REPORT_DDD_MIGRATION.md) — full migration history (4 iterations).
- [`docs/adr/README.md`](docs/adr/README.md) — 24 Architecture Decision Records.
- [`docs/ddd/README.md`](docs/ddd/README.md) — Domain-Driven Design overview.

---

## Quick Start

### Prerequisites

- **Node.js** 18.x or higher
- **npm** 9.x or higher
- (Optional) **Docker** — required for the testcontainers contract
  suite; not needed for `npm run dev` or the backend Jest suite.

### Install

```bash
git clone https://github.com/adventurewave-labs/GUI-LOP.git
cd GUI-LOP
npm install
cd src/frontend && npm install && cd ../..
```

### Run the backend (in-memory mode)

```bash
# JWT_SECRET is the one required env var; everything else has defaults.
JWT_SECRET=dev-secret npm run dev
# Server: http://localhost:3001 (HTTP + WebSocket on same port)
```

In-memory mode auto-seeds the three default workflow templates
(`data-analysis`, `decision-making`, `content-creation`). When
`DATABASE_URL` is set, Postgres is used instead and the seed runs once
through the migration job.

### Run the full stack

```bash
JWT_SECRET=dev-secret npm run dev:full
# Backend: http://localhost:3001   Frontend: http://localhost:3000
```

### Verify

```bash
# 1. Health probe (open, no auth).
curl -s http://localhost:3001/health | jq

# 2. Register a user (open). We mint an admin for this walkthrough
#    so the workflow-permission grants don't get in the way. In
#    production, the register endpoint should refuse self-promotion
#    to admin — that's a tracked follow-up.
curl -s -X POST http://localhost:3001/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"alice@example.com","username":"alice","password":"correct-horse-battery-staple","role":"admin"}'

# 3. Log in to get an access token.
TOKEN=$(curl -s -X POST http://localhost:3001/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"identifier":"alice","password":"correct-horse-battery-staple"}' \
  | jq -r '.accessToken')

# 4. List the three seeded templates (requires auth).
curl -s http://localhost:3001/api/v1/workflows/templates \
  -H "Authorization: Bearer $TOKEN" | jq '.data.templates | length'
```

---

## Architecture

The backend is split into six **bounded contexts** under
`src/backend/contexts/`. Each context follows a strict four-layer
hexagonal layout (`domain/`, `application/`, `infrastructure/`,
`interfaces/`) enforced by `dependency-cruiser` (`npm run lint:arch`).

```
                    ┌─────────────────────────┐
                    │  React SPA (port 3000)  │
                    └────────────┬────────────┘
                                 │  /api/v1/*  +  ws://…
                    ┌────────────▼─────────────┐
                    │   bootstrap (port 3001)  │
                    │   composition root        │
                    └────────────┬─────────────┘
                                 │
   ┌───────────┬────────────┬────┴────┬────────────┬──────────────┐
   ▼           ▼            ▼         ▼            ▼              ▼
┌──────┐ ┌──────────┐ ┌─────────┐ ┌──────┐ ┌────────────┐ ┌──────────────┐
│ IAM  │ │ Workflow │ │ Human   │ │  UI  │ │Notification│ │   Audit &    │
│      │ │ Orchestr.│ │ Inter.  │ │ Gen. │ │  & Real-   │ │  Analytics   │
│      │ │ (core)   │ │ (core)  │ │      │ │  time      │ │              │
└──────┘ └──────────┘ └─────────┘ └──────┘ └────────────┘ └──────────────┘
   │                                              │
   │                                              ▼
   │                                       ┌────────────┐
   │                                       │  Postgres  │  +  ┌─────────┐
   │                                       │  (or       │     │  Redis  │
   │                                       │   in-mem)  │     │ (or i.m)│
   └──────────────────────────────────────►└────────────┘     └─────────┘
```

| Context              | Role         | Code path                                    |
| -------------------- | ------------ | -------------------------------------------- |
| Identity & Access    | supporting   | `src/backend/contexts/identity-and-access/`  |
| Workflow Orchestration | **core**   | `src/backend/contexts/workflow-orchestration/` |
| Human Interaction    | **core**     | `src/backend/contexts/human-interaction/`    |
| UI Generation        | supporting   | `src/backend/contexts/ui-generation/`        |
| Notification & Realtime | supporting | `src/backend/contexts/notification/`         |
| Audit & Analytics    | generic      | `src/backend/contexts/audit-and-analytics/`  |

Shared building blocks (Result, DomainEvent, Clock/IdGen, config,
outbox, logger) live in `src/backend/shared-kernel/`.

The entry point is `src/backend/bootstrap/index.js`. Read
`src/backend/bootstrap/main.js` to see how everything is wired.

---

## API Reference (v1)

All paths are versioned under `/api/v1/`. Mutating endpoints honour
an `Idempotency-Key` header (UUID v4 recommended).

### Auth — `/api/v1/auth`

| Method | Path           | Auth | Notes                                          |
| ------ | -------------- | ---- | ---------------------------------------------- |
| POST   | `/register`    | open | `{email, username, password, role?}` → 201     |
| POST   | `/login`       | open | `{identifier, password}` → `{accessToken, refreshToken}` |
| POST   | `/refresh`     | open | `{refreshToken}` → new token pair              |
| POST   | `/logout`      | JWT  | revokes the session                            |
| POST   | `/password`    | JWT  | `{oldPassword, newPassword}`                   |
| GET    | `/me`          | JWT  | current user profile                           |

### API keys — `/api/v1/auth/api-keys`

| Method | Path  | Auth | Notes                                             |
| ------ | ----- | ---- | ------------------------------------------------- |
| POST   | `/`   | JWT  | mint a key — plaintext returned **once**, prefixed `glop_…` |
| GET    | `/`   | JWT  | list active keys for current user                  |
| DELETE | `/:id`| JWT  | revoke a key (irreversible)                       |

API keys can be used in place of JWTs on any endpoint:
`Authorization: Bearer glop_<key>`.

### Admin — `/api/v1/admin` (role `admin` required)

| Method | Path                                  | Notes                       |
| ------ | ------------------------------------- | --------------------------- |
| GET    | `/users`                              | paginated user list         |
| GET    | `/users/:id`                          | profile + activity          |
| POST   | `/users/:id/permissions`              | `{permission, scope?}`      |
| DELETE | `/users/:id/permissions/:permission`  | optional `?scope=`          |
| POST   | `/users/:id/deactivate`               |                             |
| POST   | `/users/:id/reactivate`               |                             |

### Workflows — `/api/v1/workflows` (JWT required)

| Method | Path                | Notes                                     |
| ------ | ------------------- | ----------------------------------------- |
| GET    | `/templates`        | list active templates                     |
| POST   | `/templates`        | publish a new template version (admin)    |
| POST   | `/`                 | create a workflow from a template         |
| GET    | `/:id`              | full workflow detail (steps + transitions)|
| POST   | `/:id/execute`      | run the engine until pause or terminal    |
| POST   | `/:id/cancel`       | cancel an in-flight workflow              |

### Human interaction — `/api/v1` (JWT required)

| Method | Path                            | Notes                          |
| ------ | ------------------------------- | ------------------------------ |
| POST   | `/workflows/:id/respond`        | submit a response to a paused step (Idempotency-Key required) |
| GET    | `/inbox`                        | list pending steps for current user |
| GET    | `/inbox/:workflowId/:stepId`    | single pending step             |

### UI Generation — `/api/v1/ui` (JWT required)

| Method | Path             | Notes                                     |
| ------ | ---------------- | ----------------------------------------- |
| POST   | `/generate`      | render a UI document for a step           |
| GET    | `/documents/:id` | fetch a generated document                |
| GET    | `/components`    | catalogue introspection                   |

### Analytics, audit, dashboards — `/api/v1` (JWT required)

`/analytics/workflows`, `/analytics/users/:id`, `/audit/workflows/:id`,
`/audit/aggregates/:type/:id`, `/audit/exports`,
`/dashboards/active-workflows`.

### Health — `/health` (open)

```json
{
  "status": "ok",
  "timestamp": "2026-05-10T07:31:08.123Z",
  "message": "GUI-LOP v1 (DDD) is running",
  "subsystems": {
    "db":    { "status": "disabled|ok|error:CODE", "connected": false },
    "redis": { "status": "disabled|ok|error:MSG",  "connected": false },
    "outbox":{ "lag_ms": 0, "pending_count": 0 }
  }
}
```

---

## WebSocket

Connect: `ws://localhost:3001/ws/v1?token=<accessToken>` (in dev, the
backend also accepts `?user_id=...` as a stand-in until a JWT verifier
on the upgrade is wired into production).

All messages are envelopes:

```json
{ "type": "workflow.completed", "version": 1, "payload": {...}, "occurredAt": "..." }
```

Server-to-client event types: `workflow.created`, `workflow.started`,
`workflow.step_started`, `workflow.step_completed`,
`workflow.step_failed`, `workflow.human_input_required`,
`workflow.completed`, `workflow.failed`, `workflow.cancelled`,
`human_response.recorded`, `ui.generated`.

---

## End-to-End Workflow Walk-through

```bash
# Assumes $TOKEN from the auth flow above.

# Create a data-analysis workflow.
IDEMP=$(uuidgen)
WF=$(curl -s -X POST http://localhost:3001/api/v1/workflows \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $IDEMP" \
  -d '{"template":"data-analysis","context":{"task":"Q3 sales"}}')
WID=$(echo "$WF" | jq -r '.data.workflow_id')
echo "workflow id = $WID"

# Run the engine until it pauses on the human step.
curl -s -X POST http://localhost:3001/api/v1/workflows/$WID/execute \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: $(uuidgen)" | jq '.data.stopped_reason'
# Expect: "waiting_for_human"

# Find the pending step.
SID=$(curl -s http://localhost:3001/api/v1/inbox \
  -H "Authorization: Bearer $TOKEN" | jq -r '.data[0].stepId')
echo "pending step id = $SID"

# Submit a human response.
curl -s -X POST http://localhost:3001/api/v1/workflows/$WID/respond \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d "{\"stepId\":\"$SID\",\"action\":\"approve\",\"payload\":{\"ok\":true}}" | jq '.data.action'

# Confirm completion.
curl -s http://localhost:3001/api/v1/workflows/$WID \
  -H "Authorization: Bearer $TOKEN" | jq '.data.workflow.status'
# Expect: "completed"
```

---

## Testing & Benchmarks

```bash
# Backend unit + integration suite (no infrastructure needed).
npx jest --config jest.backend.config.js
# Expect: 560 passing across 75 suites.

# Contract suite: same assertions, in-memory + Postgres adapters.
# Auto-skips cleanly when Docker is unavailable.
npm run test:contracts

# SLO benchmark suite (25 scenarios; results in tests/benchmarks/results/).
npm run bench

# Per-scenario benches.
npm run bench:workflow
npm run bench:auth
npm run bench:domain

# Frontend.
cd src/frontend && npm test                 # Jest unit
cd src/frontend && npm run test:e2e         # Playwright e2e
```

Current numbers (latest run):

| Bench                | p95     | SLO       | Status |
| -------------------- | ------- | --------- | ------ |
| `workflow.detail`    | ~1.3 ms | < 250 ms  | PASS   |
| `workflow.create`    | ~1.9 ms | < 250 ms  | PASS   |
| `workflow.lifecycle` | ~5.5 ms | < 750 ms  | PASS   |
| `auth.login`         | ~62 ms  | < 100 ms  | PASS   |
| `outbox.publish[1000]` drain | ~26 ms | < 5 s | PASS |
| `websocket.broadcast[500]` p99 | ~5 ms | < 1 s | PASS |

See `tests/benchmarks/results/latest.md` for the full table after each
run.

---

## Configuration

All config comes from environment variables. A schema-validated loader
at `src/backend/shared-kernel/config/config-loader.js` is the single
source of truth.

| Variable                  | Default                   | Notes                                  |
| ------------------------- | ------------------------- | -------------------------------------- |
| `JWT_SECRET`              | — (required)              | HS256 signing secret                   |
| `PORT`                    | `3001`                    |                                        |
| `NODE_ENV`                | `development`             |                                        |
| `DATABASE_URL`            | — (optional)              | unset = in-memory adapters             |
| `REDIS_URL`               | — (optional)              | unset = in-memory adapters             |
| `JWT_ACCESS_TTL_SECONDS`  | `900` (15 min)            |                                        |
| `JWT_REFRESH_TTL_SECONDS` | `604800` (7 d)            |                                        |
| `BCRYPT_WORK_FACTOR`      | `12` (prod), `4` (test)   | bcrypt cost; offloaded to worker pool  |
| `RATE_LIMIT_WINDOW_MS`    | `900000`                  |                                        |
| `RATE_LIMIT_MAX`          | `100`                     |                                        |
| `CORS_ORIGINS`            | `http://localhost:3000`   | csv                                    |
| `LOG_LEVEL`               | `info`                    |                                        |
| `OUTBOX_BATCH_SIZE`       | `200`                     |                                        |
| `AI_PROVIDER`             | `stub`                    | `stub`/`openai`/`anthropic`            |
| `AI_API_KEY`              | —                         | required if provider ≠ `stub`          |
| `AI_BASE_URL`, `AI_MODEL`, `AI_TIMEOUT_MS`, `AI_MAX_RETRIES` | sane defaults | per provider                |

A working dev example lives in `.env.example`.

---

## Production Deployment

See [`docs/PRODUCTION_DEPLOYMENT_GUIDE.md`](docs/PRODUCTION_DEPLOYMENT_GUIDE.md).

```bash
# Local stack via Docker Compose (Postgres + Redis + app, migrations auto-run).
docker compose up

# Build the image directly.
npm run docker:build

# Helm chart (production target).
helm lint infrastructure/helm/gui-lop
helm install gui-lop infrastructure/helm/gui-lop -f my-values.yaml
```

CI workflows under `.github/workflows/`:

| Workflow         | Trigger                      | Gate          |
| ---------------- | ---------------------------- | ------------- |
| `ci.yml`         | every PR + push to `main`    | required      |
| `arch-lint.yml`  | every PR + push to `main`    | required      |
| `docker.yml`     | push to `main`               | informational |
| `bench.yml`      | push to `main` (+ manual)    | informational |
| `contracts.yml`  | every PR + push to `main`    | informational |

---

## Development

### Project Layout

```
GUI-LOP/
├── src/
│   ├── backend/
│   │   ├── bootstrap/         # composition root (main.js, index.js, wire-*.js)
│   │   ├── shared-kernel/     # Result, DomainEvent, ports, config, outbox
│   │   └── contexts/          # six bounded contexts (DDD)
│   ├── frontend/              # React 18 SPA
│   └── api/                   # (optional, separate public API entry)
├── database/
│   ├── schemas/               # canonical SQL
│   ├── migrations/            # versioned forward migrations (001 … 010)
│   └── seeds/                 # default workflow templates
├── tests/
│   ├── integration/           # bootstrap, health, completion, forwarding…
│   ├── backend/contexts/      # additional per-context tests (Phase 4-6)
│   ├── contracts/             # testcontainers Postgres + Redis suites
│   └── benchmarks/            # SLO benchmark scenarios
├── infrastructure/
│   ├── helm/gui-lop/          # Helm chart
│   └── scripts/               # operational scripts
├── docs/
│   ├── adr/                   # 24 ADRs
│   ├── ddd/                   # strategic + tactical DDD docs
│   └── PRODUCTION_DEPLOYMENT_GUIDE.md
├── Dockerfile
├── docker-compose.yml
├── .dependency-cruiser.cjs    # strict layer + cross-context rules
├── jest.backend.config.js
├── jest.contracts.config.js
└── package.json               # main: src/backend/bootstrap/index.js
```

### Scripts

```bash
npm run dev                # backend (nodemon, bootstrap entry)
npm run dev:full           # backend + frontend
npm run start              # backend (no nodemon)
npm run typecheck          # tsc --noEmit (currently a no-op; project is pure ESM JS)
npm run lint:arch          # dependency-cruiser layer rules
npm run bench              # full SLO benchmark suite
npm run docker:build       # build the production image
npm run helm:lint          # lint the Helm chart
```

---

## Troubleshooting

### Port already in use

```bash
lsof -ti:3001 | xargs kill -9     # free port
PORT=3999 JWT_SECRET=dev-secret npm run dev   # or pick another port
```

### Fresh install

```bash
rm -rf node_modules package-lock.json && npm install
cd src/frontend && rm -rf node_modules package-lock.json && npm install && cd ../..
```

### Test cache problems

```bash
npx jest --clear-cache
```

### Contract tests "all skipped"

Expected when Docker isn't available. The suite gates each Postgres /
Redis block via `describeIfDocker`. Run them in CI (the
`contracts.yml` workflow always has Docker).

### Inspect the health probe under load

```bash
watch -n1 'curl -s http://localhost:3001/health | jq ".subsystems.outbox"'
```

---

## License

MIT — see `LICENSE`.
