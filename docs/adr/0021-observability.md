# 0021. Observability: Logs, Metrics, Traces

- **Status:** Accepted
- **Date:** 2025-10-26
- **Deciders:** Platform team
- **Tags:** observability, monitoring

## Context

We need to operate the system with confidence: detect regressions,
diagnose incidents, and report on SLOs. The three pillars (logs,
metrics, traces) must be in place from day one of production
operation, not bolted on later.

## Decision

- **Logging**: structured JSON logs to stdout, scraped by the
  platform log aggregator. Fields: `timestamp`, `level`, `service`,
  `env`, `request_id`, `session_id`, `user_id` (if known),
  `workflow_id` (if applicable), `message`, `metadata`. PII is
  redacted at the source.
- **Metrics**: Prometheus-format metrics on `/metrics` (auth-gated).
  Standard host metrics plus business metrics: workflow count by
  status, time-in-state, human-response latency, outbox lag, cache
  hit ratio, rate-limit rejections, WebSocket connection count.
- **Tracing**: OpenTelemetry SDK with auto-instrumentation for
  Express, `pg`, `ioredis`, `ws`. A `request_id` propagates as a
  baggage item and as `traceparent` for downstream calls.
- **Dashboards & Alerts**: stored in `monitoring/`. Dashboards
  cover: request volume, error rate, p50/p95/p99 latency per route,
  workflow funnel (created → running → completed), human-step
  age distribution, outbox lag, cache hit ratio.
- **SLOs**:
  - API availability: 99.9% per 30 days.
  - p95 API latency for workflow reads: < 250 ms.
  - Outbox lag p95: < 5 s.
  - WebSocket message delivery p99: < 1 s.
  - `auth.login` p95: < 100 ms. **Note (2026-05-10):** the login hot path
    is bcrypt-bound; the SLO assumes a work factor of 10 OR a
    worker-thread offload at factor 12. The platform now provides both:
    `BcryptPasswordHasher` dispatches `hash`/`compare` to a worker pool
    (`bcrypt-worker.js`, size = `max(2, cpus-1)`) so factor 12 in
    production never blocks the event loop, while the benchmark suite
    pins `BCRYPT_WORK_FACTOR=10` to validate the SLO on commodity dev
    hardware. Tests get `BCRYPT_WORK_FACTOR_TEST` (default 4) so the
    suite stays fast and deterministic.
- Each SLO has an associated burn-rate alert.

## Alternatives Considered

- **Logs-only observability** — cheap, but pivot-table debugging
  is painful at scale. Rejected.
- **Vendor lock-in (proprietary APM)** — viable, but we standardise
  on OpenTelemetry to keep portability.

## Consequences

### Positive

- Every incident has a correlation id pivot.
- SLO burn rates drive alert urgency, not raw thresholds.
- Business metrics live next to system metrics.

### Negative / Trade-offs

- Tracing adds CPU overhead; sampling rates are tuned per env (1.0
  in dev, 0.1 baseline in prod, 1.0 on flagged routes).
- Dashboard maintenance is real work; owned by the platform team
  with stewardship contributions from each context owner.

### Neutral

- The logging schema is documented as part of the shared kernel.

## Compliance and Verification

- A "synthetic monitor" test creates and completes a small workflow
  every 5 minutes against staging and production.
- An incident review checklist requires: did logs/metrics/traces
  let us diagnose this within X minutes?

## References

- OpenTelemetry semantic conventions
- `monitoring/` directory
- ADR 0014 — Outbox (lag metric)
