# Frontend Cut-Over: Legacy → /api/v1 + Versioned WebSocket Envelope

This note records the SPA-side changes that complete the GUI-LOP DDD
migration on the client. It is the companion to
`docs/MISSION_REPORT_DDD_MIGRATION.md` and ADRs 0005 / 0008 / 0017.

## What moved

| Area | Before | After |
| ---- | ------ | ----- |
| API client | `axios` instance in `src/services/api.js`, `/api/auth/*` and `/api/workflows/*` paths | `fetch`-based client in `src/services/api/client.js` + per-context modules (`auth`, `workflows`, `inbox`, `templates`, `analytics`) on `/api/v1/*` |
| Auth tokens | Access token in localStorage, refresh in `js-cookie`-backed cookie (XSS posture: short access TTL per ADR 0008) | Access token in memory + localStorage mirror, refresh in localStorage. Same XSS posture; documented in `client.js`. |
| 401 handling | Single retry from axios interceptor | Single refresh + retry; on second 401 we `window.location.assign('/login?next=…')` |
| Idempotency | None | `Idempotency-Key: <uuid v4>` auto-attached to every mutating request (POST/PUT/PATCH/DELETE) |
| WebSocket | Direct `WebSocket` per component, ad-hoc envelope shape | `createWebSocketClient()` (singleton via `useWorkflowEvents`); parses `{ type, version, payload, occurredAt }`; subscribe/unsubscribe API; exponential backoff capped at 30 s |
| Routing | Single root path with three flat tabs, embedded fetches | Feature folders (`features/auth`, `features/workflows`, `features/inbox`, `features/dashboards`, `features/admin`) with `RefreshGuard` wrapping protected routes |

## Path map (legacy → v1)

| Legacy path | New v1 path | Notes |
| ----------- | ----------- | ----- |
| `POST /api/auth/login` | `POST /api/v1/auth/login` | now also accepts `identifier` (email or username) |
| `POST /api/auth/register` | `POST /api/v1/auth/register` | requires `Idempotency-Key` |
| `POST /api/auth/refresh` | `POST /api/v1/auth/refresh` | body: `{ refreshToken }` |
| `POST /api/auth/logout` | `POST /api/v1/auth/logout` | requires bearer |
| `GET  /api/auth/me` | `GET /api/v1/auth/me` | |
| `PUT  /api/auth/password` | `POST /api/v1/auth/password` | method change; requires `Idempotency-Key` |
| `GET  /api/workflows/templates` | `GET /api/v1/workflows/templates` | response wrapped in `{ success, data: { templates } }` |
| `POST /api/workflows` | `POST /api/v1/workflows` | requires `Idempotency-Key` |
| `POST /api/workflows/:id/execute` | `POST /api/v1/workflows/:id/execute` | requires `Idempotency-Key` |
| `POST /api/workflows/:id/respond` | `POST /api/v1/workflows/:id/respond` | requires `Idempotency-Key`; body uses `step_id`, `action`, `payload` |
| `GET  /api/workflows/:id` | `GET /api/v1/workflows/:id` | |
| `GET  /api/workflows/active` | `GET /api/v1/workflows/active` | |
| _(new)_ | `GET /api/v1/inbox` | pending steps for the current user |
| _(new)_ | `GET /api/v1/inbox/:workflowId/:stepId` | step detail incl. `ui_spec` |
| _(new)_ | `GET /api/v1/dashboards/active-workflows` | |
| _(new)_ | `GET /api/v1/analytics/workflows` | |
| _(new)_ | `GET /api/v1/analytics/users/:id` | |

The legacy `/api/workflows/*` alias still exists on the backend for older
clients. The frontend no longer uses it.

## WebSocket envelope (per ADR 0005)

All v1 WebSocket frames share the same envelope:

```json
{
  "type":       "workflow.human_input_required",
  "version":    1,
  "payload":    { "workflowId": "...", "stepId": "...", "uiSpec": { ... } },
  "occurredAt": "2025-05-10T12:34:56.789Z"
}
```

The frontend `createWebSocketClient` parses this shape and dispatches by
`type`. Recognised types (registered in `KNOWN_EVENT_TYPES`):

- `workflow.created`
- `workflow.started`
- `workflow.step_started`
- `workflow.human_input_required`
- `workflow.completed`
- `workflow.failed`
- `workflow.cancelled`
- `human_response.recorded`
- `ui.generated`

Reconnect: exponential backoff (`1 s, 2 s, 4 s, …`) capped at 30 s. A clean
`disconnect()` suppresses reconnect.

The bearer is sent on the upgrade as a `?token=…` query parameter
because browser `WebSocket` constructors do not allow custom headers.
ADR 0008's short access-token TTL is the agreed mitigation. In dev mode
the backend currently authenticates upgrades via the `x-user-id` header;
the client also sends `?user_id=` so a future dev shim can match either.

## Routing map

| Path | Visibility | Component |
| ---- | ---------- | --------- |
| `/login` | public | `features/auth/Login` |
| `/register` | public | `features/auth/Register` |
| `/workflows` | protected | `features/workflows/TemplatesList` |
| `/workflows/new` | protected | `features/workflows/CreateWorkflow` |
| `/workflows/:id` | protected | `features/workflows/WorkflowDetail` |
| `/inbox` | protected | `features/inbox/PendingStepsList` |
| `/inbox/:workflowId/:stepId` | protected | `features/inbox/RespondForm` |
| `/dashboards/active` | protected | `features/dashboards/ActiveWorkflows` |
| `/dashboards/analytics` | protected | `features/dashboards/WorkflowAnalytics` |
| `/dashboards/me` | protected | `features/dashboards/UserActivity` |
| `/admin/*` | protected | `features/admin/AdminPlaceholder` (stub) |

`RefreshGuard` checks `useAuth()`. If the auth context is hydrating, it
renders a loading marker; if unauthenticated it redirects to
`/login?next=<encoded current path>`.

## Running tests locally

### Unit tests

```sh
cd src/frontend
npm test            # one-shot via react-scripts test --watchAll=false
npm run test:watch  # watch mode
```

The frontend Jest config (`package.json` → `jest.testMatch`) only picks
up tests under `src/services/**` and `src/features/**`, so the suite
runs without the backend.

### Playwright e2e

```sh
cd src/frontend
npx playwright install --with-deps   # one-time
npm run test:e2e
```

`playwright.config.js` boots:

- the v1 backend (`node src/backend/bootstrap/index.js`) on port 3001,
  reachable at `http://localhost:3001/health`. With no `DATABASE_URL`
  / `REDIS_URL` the backend uses in-memory adapters and seeds the three
  default workflow templates (`data-analysis`, `decision-making`,
  `content-creation`) automatically.
- the CRA dev server on port 3000.

The `e2e/auth.spec.js` and `e2e/workflow-lifecycle.spec.js` specs cover
register / login / refresh and the create → execute → respond → completed
loop end-to-end via the WebSocket-driven detail page and inbox.
