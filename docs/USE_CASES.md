# GUI-LOP End-User Use Cases

A practical guide to **using** the GUI-LOP platform. This document is
written for the people who interact with the platform after it has
been deployed — operators, reviewers, template authors, integrators,
auditors. Each section describes one realistic scenario, walks through
the steps, and shows the expected outcome.

For architecture, design decisions, or contributor docs, see
[`README.md`](../README.md), [`docs/adr/`](adr/README.md), and
[`docs/ddd/`](ddd/README.md).

---

## Who Is This Platform For?

GUI-LOP runs business processes that mix automated steps with human
decisions. Five personas appear across the use cases below.

| Persona               | Cares about                                               | Typical role               |
| --------------------- | --------------------------------------------------------- | -------------------------- |
| **Operator**          | Submitting workflows, watching them run, fixing stuck ones | Operations, line-of-business |
| **Reviewer**          | Receiving "needs your input" notifications and approving / rejecting | Manager, subject-matter expert |
| **Template Author**   | Defining new workflow shapes                              | Solution architect          |
| **Administrator**     | Users, roles, API keys, dashboards, audit                 | Platform owner              |
| **Integrator**        | Driving the platform from another service or script       | Developer of an upstream system |

---

## Conventions Used in Every Use Case

- All API examples use `curl` against a backend running locally on
  `http://localhost:3001`. Replace with your deployment URL.
- Anywhere `$TOKEN` appears, substitute a fresh JWT access token
  obtained from [Use Case 1](#use-case-1-sign-in-and-get-an-access-token).
- All mutating endpoints accept an `Idempotency-Key` header (any
  UUID v4) so retries are safe.
- The platform speaks JSON; pipe to `jq` for readability.

---

## Use Case 1: Sign In and Get an Access Token

**Persona:** every user.
**Scenario:** before you can do anything else, you need an account and
a short-lived access token.

### Step 1 — Create an account

Open registration is enabled in dev environments. In production this
is usually an admin-only operation (see Use Case 10).

```bash
curl -s -X POST http://localhost:3001/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "ops@example.com",
    "username": "ops",
    "password": "long-and-memorable-pass-phrase"
  }'
```

You get back your user id and role (`user` by default):

```json
{ "id": "…", "email": "ops@example.com", "username": "ops", "role": "user" }
```

### Step 2 — Sign in

```bash
TOKEN=$(curl -s -X POST http://localhost:3001/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"identifier": "ops", "password": "long-and-memorable-pass-phrase"}' \
  | jq -r '.accessToken')
```

The login response contains:

- `accessToken` — short-lived JWT (15 min default). Use as
  `Authorization: Bearer $TOKEN`.
- `refreshToken` — long-lived (7 d default). Use to get a new access
  token when the current one expires.
- `sessionId` — opaque id for the active session.

### Step 3 — Check your profile

```bash
curl -s http://localhost:3001/api/v1/auth/me \
  -H "Authorization: Bearer $TOKEN" | jq
```

### When the access token expires

Send the refresh token to `/api/v1/auth/refresh`; you'll get a new
pair. The previous refresh token is invalidated atomically.

---

## Use Case 2: Submit a Workflow That Needs a Human Decision

**Persona:** Operator.
**Scenario:** the quarterly sales numbers are in. You need them
analysed, you want a manager to sign off before the report goes to the
exec team.

### Step 1 — Discover available templates

```bash
curl -s http://localhost:3001/api/v1/workflows/templates \
  -H "Authorization: Bearer $TOKEN" | jq '.data.templates[] | {id, name, steps: (.steps | length)}'
```

Out of the box you'll see three:

```
{ "id": "data-analysis",    "name": "Data Analysis Workflow",    "steps": 5 }
{ "id": "decision-making",  "name": "Decision Making Workflow",  "steps": 5 }
{ "id": "content-creation", "name": "Content Creation Workflow", "steps": 5 }
```

### Step 2 — Create a workflow instance

You supply the **template** and a **context** — arbitrary JSON the
template will operate on.

```bash
WF=$(curl -s -X POST http://localhost:3001/api/v1/workflows \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{
    "template": "data-analysis",
    "context": {
      "task": "Q3 sales analysis",
      "dataSource": "s3://reports/sales_q3.csv",
      "audience": "executive team"
    }
  }')
WID=$(echo "$WF" | jq -r '.data.workflow_id')
echo "Created workflow $WID"
```

### Step 3 — Start it

```bash
curl -s -X POST "http://localhost:3001/api/v1/workflows/$WID/execute" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: $(uuidgen)" | jq '.data'
```

The engine runs the automated steps (ingest → analyse → generate
insights) and stops:

```json
{
  "workflow_id": "…",
  "status": "waiting_for_human",
  "stopped_reason": "waiting_for_human",
  "ran_steps": 3
}
```

At this point a reviewer's inbox lights up and the workflow waits.

---

## Use Case 3: Review and Approve a Pending Step

**Persona:** Reviewer (manager, SME).
**Scenario:** you got a notification that a workflow needs your
review.

### Step 1 — Open your inbox

```bash
curl -s http://localhost:3001/api/v1/inbox \
  -H "Authorization: Bearer $TOKEN" | jq '.data'
```

Each entry includes the workflow id, step id, eligibility info,
deadline (if any), and how the step should behave on timeout
(`fail`, `escalate`, or `auto_approve`):

```json
[
  {
    "workflowId": "…",
    "stepId": "…",
    "uiDocumentId": null,
    "eligibility": { "requiredRole": null, "requiredPermissions": [], "scope": null },
    "deadline": null,
    "onTimeout": "escalate",
    "escalationLevel": 0,
    "openedAt": "…",
    "closedAt": null
  }
]
```

### Step 2 — Inspect the workflow context

The intermediate analysis output is on the workflow:

```bash
curl -s http://localhost:3001/api/v1/workflows/$WID \
  -H "Authorization: Bearer $TOKEN" | jq '.data.workflow.context'
```

You'll see the `task`, `dataSource`, plus the output each automated
step produced (e.g. `"Insight Generation"` carrying the candidate
insights you're being asked to approve).

### Step 3 — Submit your response

```bash
curl -s -X POST "http://localhost:3001/api/v1/workflows/$WID/respond" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $(uuidgen)" \
  -d "{
    \"stepId\": \"$SID\",
    \"action\": \"approve\",
    \"payload\": {
      \"approvedInsights\": [\"Q3 revenue up 12% YoY\", \"APAC strongest region\"],
      \"notes\": \"Numbers reconcile with the CFO's pre-read.\"
    },
    \"rationale\": \"Reviewed against the source CSV, no outliers.\",
    \"confidence\": 0.92
  }" | jq '.data'
```

The workflow advances through the remaining automated steps and
finishes:

```bash
curl -s http://localhost:3001/api/v1/workflows/$WID \
  -H "Authorization: Bearer $TOKEN" | jq '.data.workflow.status'
# "completed"
```

### Idempotency

If your network drops and you retry with the same
`Idempotency-Key`, you get the original response back (with
`"deduplicated": true`) — no double-write. Retry with a *different*
key after a successful response and you'll get a `409 Conflict`
because the step is already closed.

---

## Use Case 4: Reject or Modify a Response

**Persona:** Reviewer.
**Scenario:** the AI's analysis missed something; you want to push
back instead of approving.

### Reject outright

```bash
curl -s -X POST "http://localhost:3001/api/v1/workflows/$WID/respond" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $(uuidgen)" \
  -d "{
    \"stepId\": \"$SID\",
    \"action\": \"reject\",
    \"payload\": {},
    \"rationale\": \"Source data is from a stale ETL; need a re-run before approval.\"
  }"
```

The workflow's terminal status will be `failed` (the engine sees a
rejection at a required gate and does not continue). The rationale
is recorded and queryable from the audit trail (Use Case 8).

### Modify (counter-propose)

```bash
curl -s -X POST "http://localhost:3001/api/v1/workflows/$WID/respond" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $(uuidgen)" \
  -d "{
    \"stepId\": \"$SID\",
    \"action\": \"modify\",
    \"payload\": {
      \"correctedInsights\": [
        \"Q3 revenue up 9% YoY (after FX-adjustment)\",
        \"APAC strongest region\"
      ]
    },
    \"rationale\": \"FX adjustment was missing from the auto-analysis.\",
    \"confidence\": 0.95
  }"
```

The workflow resumes with the *modified* payload threaded into the
remaining steps; the original AI-proposed payload is preserved on the
response record for the audit trail.

---

## Use Case 5: Cancel a Stuck Workflow

**Persona:** Operator.
**Scenario:** a workflow has been waiting for human input for two
weeks because the reviewer is on leave. You need to stop it and start
a fresh one routed differently.

```bash
curl -s -X POST "http://localhost:3001/api/v1/workflows/$WID/cancel" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"reason": "Reviewer unavailable; restarting with alternate routing."}' | jq
```

The workflow's terminal status becomes `cancelled`, all pending steps
are closed, and a `workflow.cancelled` event is emitted to any
subscribed dashboards / webhooks. The reason is permanent on the
audit trail.

You can now create a fresh instance via Use Case 2.

---

## Use Case 6: Operator Dashboard — What's In Flight?

**Persona:** Operator / line manager.
**Scenario:** Monday morning standup — what's running, what's stuck?

```bash
curl -s http://localhost:3001/api/v1/dashboards/active-workflows \
  -H "Authorization: Bearer $TOKEN" | jq '.items'
```

In a dev environment (no Postgres views) this returns an empty list.
In production this is backed by the `active_workflows` view and shows
every workflow in `created`, `running`, or `waiting_for_human`, with
its template, creator, and current duration.

Complementary queries:

```bash
# Throughput + average execution time by template over the last 30 days.
curl -s http://localhost:3001/api/v1/analytics/workflows \
  -H "Authorization: Bearer $TOKEN" | jq '.items'

# Per-user activity (use your own id, or any user id if you're admin).
ME=$(curl -s http://localhost:3001/api/v1/auth/me -H "Authorization: Bearer $TOKEN" | jq -r '.id')
curl -s "http://localhost:3001/api/v1/analytics/users/$ME" \
  -H "Authorization: Bearer $TOKEN" | jq '.items'
```

---

## Use Case 7: Real-Time UI Updates via WebSocket

**Persona:** anyone building a frontend / monitor against the
platform.
**Scenario:** rather than polling, you want the platform to push you
events as they happen — workflow paused for input, response recorded,
completion, etc.

### Connect

```javascript
const ws = new WebSocket(
  `ws://localhost:3001/ws/v1?token=${accessToken}`,
);
```

The backend uses the same auth path as HTTP. Send the access token on
the upgrade.

### Event envelope

Every message is JSON:

```json
{ "type": "workflow.completed", "version": 1, "payload": { … }, "occurredAt": "…" }
```

### Event types you'll see

- `workflow.created`, `workflow.started`
- `workflow.step_started`, `workflow.step_completed`, `workflow.step_failed`
- `workflow.human_input_required` — show a banner / play a sound; a
  reviewer's input is needed.
- `human_response.recorded` — the response just landed.
- `ui.generated` — a dynamic UI is available at the URL in the payload.
- `workflow.completed`, `workflow.failed`, `workflow.cancelled`.

### Reconnect

Clients should reconnect with exponential backoff. The SPA's
`src/frontend/src/services/websocket/client.js` is a working reference
implementation.

---

## Use Case 8: Audit a Completed Workflow

**Persona:** Compliance officer.
**Scenario:** a customer disputes the outcome of a workflow from
three months ago. You need a full record: who decided what, when, on
which inputs.

### Full event trail for one workflow

```bash
curl -s "http://localhost:3001/api/v1/audit/workflows/$WID" \
  -H "Authorization: Bearer $TOKEN" | jq
```

Returns every domain event published for that workflow — creation,
each step transition, the human response (including the responder's
id and rationale), and the final completion / failure.

### Trail for any aggregate

```bash
curl -s "http://localhost:3001/api/v1/audit/aggregates/Workflow/$WID" \
  -H "Authorization: Bearer $TOKEN"

curl -s "http://localhost:3001/api/v1/audit/aggregates/HumanResponse/$RESPONSE_ID" \
  -H "Authorization: Bearer $TOKEN"
```

Useful when an investigation focuses on a specific entity rather than
a whole workflow.

### Compliance export

For a litigation hold or auditor request, produce a signed archive:

```bash
curl -s -X POST http://localhost:3001/api/v1/audit/exports \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "scope": {"workflowIds": ["…", "…"]},
    "range": {"from": "2026-01-01T00:00:00Z", "to": "2026-03-31T23:59:59Z"}
  }' | jq
```

The response contains the export id and a URL to a JSON archive of
the matching events.

---

## Use Case 9: Publish a New Workflow Template

**Persona:** Template Author (typically admin-level).
**Scenario:** you've designed a "loan approval" workflow with
collect-application → score → human-underwriter → notify-applicant
and want to publish it.

```bash
curl -s -X POST http://localhost:3001/api/v1/workflows/templates \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "key": "loan-approval",
    "version": 1,
    "name": "Loan Approval Workflow",
    "description": "Collects an application, scores it automatically, then routes to an underwriter for borderline cases.",
    "steps": [
      {"name": "Collect Application", "kind": "automated"},
      {"name": "Risk Scoring",        "kind": "automated"},
      {
        "name": "Underwriter Review",
        "kind": "human",
        "uiSpec": {"fields": [
          {"name": "decision", "type": "select", "options": ["approve", "reject", "request-more-info"]},
          {"name": "rationale", "type": "text"}
        ]},
        "deadline": 86400000,
        "onTimeout": "escalate"
      },
      {"name": "Notify Applicant", "kind": "automated"}
    ],
    "defaultConfig": {"riskThreshold": 0.7}
  }' | jq
```

Once published, the template is immutable at that version. To change
it later, publish version `2` — workflows already in flight keep
running against the version they were started with.

The new template appears in everyone's `GET /workflows/templates`
results within a second of publication.

---

## Use Case 10: Administer Users, Roles, and Permissions

**Persona:** Administrator.
**Scenario:** a new SME joins the team and needs permission to
respond to compliance workflows (but nothing else).

### List users

```bash
curl -s http://localhost:3001/api/v1/admin/users \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq '.users[] | {id, username, role, isActive}'
```

### Grant a scoped permission

```bash
curl -s -X POST "http://localhost:3001/api/v1/admin/users/$USER_ID/permissions" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "permission": "workflow:respond",
    "scope": "compliance-review"
  }'
```

Now that user can respond to any workflow whose template key is
`compliance-review` but cannot, say, create or cancel other workflows.

### Deactivate a user

When someone leaves the org:

```bash
curl -s -X POST "http://localhost:3001/api/v1/admin/users/$USER_ID/deactivate" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

Existing sessions remain valid until they expire (15 min for access
tokens), but no new sessions can be created. The user's email is
preserved for audit; only the `is_active` flag changes.

To reactivate, hit the same path with `/reactivate`.

### Revoke a permission

```bash
curl -s -X DELETE \
  "http://localhost:3001/api/v1/admin/users/$USER_ID/permissions/workflow:respond?scope=compliance-review" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

---

## Use Case 11: Mint an API Key for a CI/CD Job

**Persona:** Integrator.
**Scenario:** a nightly Jenkins job needs to create and execute
`data-analysis` workflows automatically. You don't want to embed a
human user's JWT in CI — you want a long-lived, revocable, scoped
credential.

### Mint the key

```bash
KEYRESP=$(curl -s -X POST http://localhost:3001/api/v1/auth/api-keys \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{
    "name": "nightly-sales-job",
    "permissions": ["workflow:create", "workflow:execute"],
    "expiresAt": "2027-01-01T00:00:00Z"
  }')
echo "$KEYRESP" | jq
```

The response contains a `plaintextKey` like `glop_…43-base64url-chars`.
**This is the only time you will see it.** Store it in Jenkins
credentials immediately; only the SHA-256 digest is kept server-side.

### Use the key

Same `Authorization: Bearer …` header as a JWT — the platform
detects the `glop_` prefix and verifies it against the key store
instead of as a JWT.

```bash
curl -s http://localhost:3001/api/v1/workflows/templates \
  -H "Authorization: Bearer glop_Uulqexnlhi7d3_jkFLe9rxwuxuorfOnY4r4DandBPLc"
```

### List your active keys

```bash
curl -s http://localhost:3001/api/v1/auth/api-keys \
  -H "Authorization: Bearer $TOKEN" | jq '.apiKeys[] | {id, name, expiresAt, isActive}'
```

### Revoke (immediately and irreversibly)

```bash
curl -s -X DELETE "http://localhost:3001/api/v1/auth/api-keys/$KEY_ID" \
  -H "Authorization: Bearer $TOKEN"
```

If a key leaks, revoke it — every request after the revocation will
401, no key rotation required.

---

## Use Case 12: Receive Workflow Events on a Webhook

**Persona:** Integrator running an external system.
**Scenario:** your CRM should be notified whenever a customer-facing
workflow completes so it can write the outcome onto the customer
record.

### Register a webhook subscription

```bash
curl -s -X POST http://localhost:3001/api/v1/webhooks \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://crm.example.com/hooks/gui-lop",
    "signingSecret": "shared-secret-known-only-to-CRM-and-us",
    "filters": {
      "eventTypes": ["workflow.completed", "workflow.failed"]
    }
  }' | jq
```

The platform stores the signing secret hashed and remembers the URL
plus filter.

### What your endpoint receives

Each event is delivered as a `POST` with the standard envelope:

```json
{ "type": "workflow.completed", "version": 1, "payload": { … }, "occurredAt": "…" }
```

Headers include:
- `X-GUI-LOP-Event-Id` — unique per delivery (dedupe on this).
- `X-GUI-LOP-Signature` — HMAC-SHA-256 over a `<timestamp>.<body>`
  string using your signing secret. Verify before trusting the body.
- `X-GUI-LOP-Timestamp` — used as the HMAC input; reject if more than
  five minutes off your clock.

### Delivery semantics

- **At-least-once** — your endpoint may be called twice with the
  same `X-GUI-LOP-Event-Id`. Dedupe on it.
- **Exponential backoff** if you 5xx; after the configured retry
  budget the delivery moves to the dead-letter queue. An admin can
  inspect dead letters via `GET /api/v1/dead-letters` and retry via
  `POST /api/v1/dead-letters/:id/retry`.

---

## Frequently Asked Questions

### "I got a 401 on every endpoint I tried."

Your access token expired (default 15 min). Refresh it:

```bash
TOKEN=$(curl -s -X POST http://localhost:3001/api/v1/auth/refresh \
  -H 'Content-Type: application/json' \
  -d "{\"refreshToken\": \"$REFRESH\"}" | jq -r '.accessToken')
```

### "I got a 403 on workflow:create."

Your role doesn't include the permission. Either ask an admin for a
scoped grant (Use Case 10) or — if you are the admin — promote your
own role. Admins implicitly hold every permission.

### "I got a 409 on respond."

Either: (a) the step has already been resolved by another reviewer
(first valid response wins), or (b) you sent a different body with a
previously-used `Idempotency-Key`. In case (a), refresh your inbox.
In case (b), use a fresh idempotency key.

### "I got a 429."

Rate limit. The platform allows 5 failed logins per IP per 15 min,
plus per-user budgets on mutating workflow endpoints. Wait, or have
an admin increase your budget.

### "I want to stop everything and rerun from scratch."

In production, cancel workflows individually (Use Case 5). In dev,
restart the server — in-memory mode forgets everything between
restarts, which is exactly why production uses Postgres.

### "Where do I see what permissions exist?"

Every endpoint that requires a permission documents it in
`docs/ddd/03-bounded-contexts/identity-and-access.md`. The current
catalogue: `workflow:{create,read,execute,respond,cancel}`,
`template:{publish,deprecate}`, `audit:read`, `user:{read,manage}`,
`api-key:{mint,revoke}`. Optionally scoped to a workflow id,
template key, or (in future) organization id.

---

## Where Next

- The full API reference lives in [`README.md`](../README.md).
- The platform's operational SLOs are in
  [`docs/adr/0021-observability.md`](adr/0021-observability.md).
- For deployment and operations, see
  [`docs/PRODUCTION_DEPLOYMENT_GUIDE.md`](PRODUCTION_DEPLOYMENT_GUIDE.md).
- For the underlying domain model and why the platform is built this
  way, browse [`docs/ddd/`](ddd/README.md).
