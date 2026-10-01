# SOTA Improvement Loop — GUI-LOP

Working branch: `claude/sota-loop` (draft PR → `main`). **Never merged by an agent** — Triple-Gate applies.

## Loop contract (every iteration)

1. `git fetch origin && git rebase origin/claude/sota-loop` — pick the **first unchecked** item below.
2. Implement it end-to-end: code + tests + config/infra/docs touch-points. Scope to one item; split if it won't fit in ~20 min.
3. Gate: `NODE_ENV=test JWT_SECRET=x npx jest --config jest.backend.config.js src/backend/ tests/backend/contexts/ tests/integration/bootstrap-smoke.test.js` green + `npm run lint:arch` 0 errors (+ `npm run lint` once item 5 lands).
4. Commit (conventional), push to `claude/sota-loop`, tick the item here with a one-line result + commit sha.
5. Blocked / 3 failed attempts → mark `[!]` with the blocker and move to the next item.
6. No paid API calls (AI adapters are verified offline against recorded fixtures / stub). No secrets in output.

## Done

- [x] **L0 — WebSocket auth + HTTP hardening.** WS upgrades now require a verified JWT/API key (`?token=`, `Authorization`, or `Sec-WebSocket-Protocol: bearer,<t>`); forged `X-User-Id` → 401 (was full account takeover of any user's event stream). Dev escape hatch `WS_ALLOW_HEADER_AUTH` refused in production. Helmet (API CSP `default-src 'none'`), validated + echoed `X-Request-Id`, `TRUST_PROXY`, server `headersTimeout`/`requestTimeout`/`keepAliveTimeout` (LB-aligned), `/livez` + `/readyz` (bounded 800 ms dep probes, 503 while draining), body-parser 400/413 no longer surface as 500. Probes in Helm/K8s/Dockerfile repointed. +34 tests.

- [x] **1. Graceful drain** (`8b215f5`). SIGTERM → `/readyz` 503 + `Connection: close` while still serving for `SHUTDOWN_DRAIN_DELAY_MS` → stop outbox/watchers → WS 1001 → HTTP close with idle sweep + force-close at deadline → release pools. Fixed `ws-server.close()` leaving live sockets open. Helm/compose grace periods aligned. In-flight shutdown 2.0 s → 0.24 s. 583 → 589 tests.
- [x] **2. Request-scoped context** (`10a6905`). AsyncLocalStorage per request (`request_id`, `user_id`, `auth_via`) auto-injected into every log line; recursive credential redaction in the logger; `http_request` access log with bounded route template, status, duration, 499 on abort, never the query string. 589 → 602 tests.

## Backlog (priority order)

- [ ] **3. W3C Trace Context.** Parse/propagate `traceparent`/`tracestate`; emit on outbound AI + webhook calls; OTel SDK optional (enabled only when `OTEL_EXPORTER_OTLP_ENDPOINT` set, zero-cost otherwise).
- [ ] **4. Prometheus `/metrics`.** `prom-client`: RED histograms per route template, outbox lag/pending gauges, WS connections, AI call latency/errors/circuit state, event-loop lag. Guarded by `METRICS_TOKEN` or separate port.
- [ ] **5. Real lint.** ESLint 9 flat config (`@eslint/js` + `eslint-plugin-n` + `eslint-plugin-security`), replace placeholder script, add CI job. Fix or explicitly suppress findings.
- [ ] **6. Node 22 LTS.** Node 18 is EOL. Bump CI matrix, Dockerfiles, devcontainer, `engines`, `.nvmrc`; `node --test`-safe flags.
- [ ] **7. Supply chain.** Dependabot (npm, actions, docker), pin Actions by SHA, CodeQL workflow, `npm audit --omit=dev --audit-level=high` gate, CycloneDX SBOM + build provenance/attestation in `docker.yml`, `permissions:` least-privilege on every workflow.
- [ ] **8. WebSocket hardening II.** BUG found in loop 1: `ws-server.js` `idleTimer` is never reset on pong/message, so every socket is terminated 30 s after connect regardless of activity — fix first. Then: restrict upgrades to `/ws/v1`, Origin allow-list (reuse `CORS_ORIGINS`), per-user connection cap, `maxPayload`, close 4001 on access-token `exp`, backpressure (`bufferedAmount`) guard.
- [ ] **9. Frontend WS client → subprotocol auth.** Move token from `?token=` to `Sec-WebSocket-Protocol` so it never lands in proxy/access logs; drop `user_id` param.
- [ ] **10. Rate limiting audit.** Verify/route `express-rate-limit` + Redis store on `/auth/*` (login, refresh, register) with per-IP+per-identifier keys and `RateLimit-*` (draft-7) headers; tests.
- [ ] **11. RFC 9457 problem+json.** Unified `application/problem+json` error envelope (type/title/status/detail/instance + request_id) across contexts, backwards-compatible `error` field.
- [ ] **12. AI adapter SOTA.** Structured output via tool-use/JSON-schema for UI document drafts (schema already in `ui-document-draft-schema.js`), prompt caching on the static system prompt, configurable model ids per tier, token/cost telemetry. Offline fixture tests only.
- [ ] **13. Contract tests un-skipped.** `jest.contracts.config.js` currently skips all 148 tests — make them run against the in-memory bootstrap and add to CI.
- [ ] **14. Type safety.** `checkJs` + JSDoc on `shared-kernel` and `bootstrap` first; real `npm run typecheck`; remove `continue-on-error`.
- [ ] **15. Coverage + mutation gates.** CI coverage report with per-context thresholds; Stryker on `*/domain` with a baseline mutation score.
