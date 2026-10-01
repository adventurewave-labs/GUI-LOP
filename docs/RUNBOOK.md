# GUI-LOP Runbook

Operating guide for the API in production and staging. Deployment mechanics, configuration rules,
SLOs, backups and the migration policy are in [`PRODUCTION_DEPLOYMENT_GUIDE.md`](PRODUCTION_DEPLOYMENT_GUIDE.md);
this file is what to do when something needs doing. Alert names below match
`docker/monitoring/gui-lop-rules.yml` (each alert's `runbook_url` points at its heading here).

## Go-live checklist

- [ ] `NODE_ENV=production`, and the service boots without `config:` warnings you have not accepted
      (the loader refuses weak/missing settings — see the deployment guide).
- [ ] `JWT_SECRET` from `openssl rand -hex 32`, stored in the platform secret store, not in git.
- [ ] `DATABASE_URL` and `REDIS_URL` point at managed, backed-up instances; `ALLOW_EPHEMERAL_STATE` unset.
- [ ] `TRUST_PROXY` = number of proxy hops in front of the API (Railway: `1`). Wrong value = every
      client shares one rate-limit bucket, or clients can spoof their IP.
- [ ] `CORS_ORIGINS` = the exact SPA origin(s), https.
- [ ] `METRICS_TOKEN` set (≥ 16 chars) and mounted for Prometheus; `/metrics` answers 401 without it.
- [ ] Migrations run as a pre-deploy step (`node database/migrations/migrate.js migrate`) and the
      healthcheck is `/readyz`.
- [ ] `npm run db:drill` passes against the production database (`DRILL_STRICT=0`) and a backup
      schedule exists; restore time measured.
- [ ] `node scripts/smoke.mjs --base <url> --metrics-token …` is green against the deployed URL.
- [ ] Alert rules loaded; a test alert reaches the on-call channel.
- [ ] First admin created (below), default sign-up role is `user`.
- [ ] `AI_PROVIDER` decided: `stub` returns deterministic placeholder UI; a real provider needs
      `AI_API_KEY` and costs money per call.
- [ ] Egress from the API restricted at the network layer where possible (webhooks are validated
      against private addresses at registration, but DNS can change afterwards).

## Routine operations

### Deploy

Railway (staging): push to the tracked branch → build → pre-deploy migrations → `/readyz` healthcheck →
30 s drain of the old instance. `staging-smoke.yml` waits until `/livez` reports the pushed commit
(`version`) and runs the smoke test. Kubernetes: `helm upgrade` (migration Job, then rollout).

Verify: `curl $URL/livez` shows the expected `version`; smoke green; no `ApiHighErrorRate`.

### Roll back

Redeploy the previous image/commit (Railway: *Redeploy* on the last good deployment; Helm:
`helm rollback`). **The schema is not rolled back** — migrations are forward-only and every one must
be compatible with the previous release. If a migration itself is the problem, restore from the
backup taken before the release (deployment guide, "Backups, restore and the restore drill").

### Create the first admin

Sign-up always creates role `user`. Promote in the database once, then use the admin API:

```sql
UPDATE users SET role = 'admin' WHERE email = 'you@example.com';
```

After that: `POST /api/v1/admin/users/{id}/permissions` (grant), `/deactivate`, `/reactivate`.
Admins hold every permission implicitly; a scoped API key bounds even an admin.

### Rotate secrets

- **`JWT_SECRET`**: set the new value and restart. All access tokens become invalid; users sign in
  again (refresh tokens are opaque and stored hashed, so they survive, but the new access token is
  signed with the new secret). Rotate immediately if it may have leaked.
- **`METRICS_TOKEN`**: update the service and Prometheus' `credentials_file` together.
- **Database / Redis credentials**: rotate at the provider, update `DATABASE_URL` / `REDIS_URL`, restart.
- **A user's sessions**: deactivate + reactivate the user, or have them change their password.
- **An API key**: `DELETE /api/v1/auth/api-keys/{id}` (takes effect immediately).

### Scale

The API is stateless and CPU-bound (deployment guide, baseline). Add replicas first. Keep
`replicas × DB_POOL_MAX` below the database's `max_connections` (leave headroom for migrations).
Raise `AUTH_LOGIN_IP_LIMIT` if many users share one egress IP.

## Alerts

### ApiDown

Prometheus cannot scrape `/metrics`. Check, in order: is the process up (`/livez`)? Did the boot
fail (log starts with `Failed to start GUI-LOP v1: ConfigError` and lists every bad setting)? Does
Prometheus send the right `METRICS_TOKEN` (401) or is none configured on the service (404)?

### ApiRestarting

Crash loop. Read the boot log: a `ConfigError` names the setting; otherwise look for the last
`unhandled request error` / stack trace. Roll back if it started with a deploy.

### ApiHighErrorRate

More than 1 % 5xx. `http_request` log lines carry `route`, `status`, `request_id`, `trace_id`;
`unhandled request error` lines carry the stack. Find the route with
`sum by (route) (rate(http_request_duration_seconds_count{status_code=~"5.."}[5m]))`.
If it started with a deploy, roll back first, diagnose second.

### ApiLatencyHigh

p95 > 250 ms or p99 > 600 ms (login/register/password excluded). Check `EventLoopLagHigh` (CPU —
add replicas), `DbPoolSaturated` (database), and the slowest routes:
`histogram_quantile(0.95, sum by (le, route) (rate(http_request_duration_seconds_bucket[5m])))`.

### ApiOverloaded

The API is answering 503 + `Retry-After`: a query hit `DB_STATEMENT_TIMEOUT_MS` or
`DB_LOCK_TIMEOUT_MS`, the pool could not hand out a connection within `DB_CONNECT_TIMEOUT_MS`, or
the database restarted/failed over. Clients retry on their own. Look at the database (CPU, locks:
`SELECT * FROM pg_stat_activity WHERE application_name = 'gui-lop-api' AND state <> 'idle'`).

### EventLoopLagHigh

The Node.js event loop is blocked: CPU saturation or synchronous work on the request path. Add
replicas; if it persists at low traffic, profile.

### DbPoolSaturated

Requests wait for a pooled connection. Either queries are slow (check the database) or the pool is
too small for the traffic: raise `DB_POOL_MAX` (mind `max_connections`) or add replicas.

### OutboxLagHigh

Events (notifications, webhooks, cross-replica fan-out, projections) are delivered late (> 30 s) or
not at all (`OutboxStalled`, > 10 min). The consumer runs inside every API instance and claims rows
with a lease, so one healthy instance is enough.

```sql
SELECT status, count(*), min(occurred_at) FROM outbox GROUP BY status;
SELECT event_type, retry_count, last_error, next_attempt_at FROM outbox
 WHERE status = 'pending' ORDER BY occurred_at LIMIT 20;
```

`last_error` says why deliveries fail (a subscriber that is down backs off exponentially and does
not block other events). If nothing is being attempted at all, restart the API.

### OutboxMetricsBroken

The outbox gauges report `-1`: the metrics queries fail. Usually the database is unreachable or
slow (`/readyz` will also fail) — treat as a database incident.

### OutboxDeadLetters

Events exhausted their 10 attempts. Each one is a notification, webhook or projection update that
did not happen. Fix the cause first (`last_error`), then replay:

```sql
SELECT id, event_type, aggregate_id, last_error, occurred_at FROM outbox WHERE status = 'dead_letter';

-- replay everything (or add a WHERE on event_type / id)
UPDATE outbox SET status = 'pending', retry_count = 0, next_attempt_at = NOW(), locked_until = NULL
 WHERE status = 'dead_letter';
```

Handlers are idempotent on the event id, so replaying is safe. Per-subscriber delivery dead letters
(a webhook endpoint that kept failing) are separate: `GET /api/v1/dead-letters` and
`POST /api/v1/dead-letters/{id}/retry` (admin, or permission `notification:admin`).

### AiCircuitOpen

The AI provider is failing or timing out, so the circuit breaker fails fast and UI generation
returns errors. Check the provider's status and `AI_API_KEY`/quota. Workflows waiting on generated
UI resume when the circuit closes; nothing needs replaying. To stop spend or errors entirely, set
`AI_PROVIDER=stub` and restart.

## Incidents

- **Security incident** (leaked secret, suspicious access): `SECURITY_INCIDENT_RESPONSE_PROCEDURES.md`,
  then rotate (above). Refresh-token reuse is detected automatically and revokes the session
  (`session.refresh_token_reused` event).
- **Data loss / corruption**: stop writers, restore the newest verified backup into an empty
  database, repoint `DATABASE_URL`, deploy, smoke — full procedure in the deployment guide.
- **Who can see what**: audit trail and exports need `audit:read` / `audit:export`; dead letters need
  `notification:admin`; subscriptions are visible only to their owner (and admins).
