# SOTA Improvement Loop — GUI-LOP

Working branch: `claude/sota-loop` (draft PR → `main`). **Never merged by an agent** — Triple-Gate applies.

## Loop contract (every iteration)

1. `git fetch origin && git rebase origin/claude/sota-loop` — pick the **first unchecked** item below.
2. Implement it end-to-end: code + tests + config/infra/docs touch-points. Scope to one item; split if it won't fit in ~20 min.
3. Gate: `NODE_ENV=test JWT_SECRET=x npx jest --config jest.backend.config.js src/backend/ tests/backend/contexts/ tests/integration/bootstrap-smoke.test.js` + `npm run test:frontend-services` green + `npm run lint:arch` 0 errors (+ `npm run lint` (0 warnings)).
4. Commit (conventional), push to `claude/sota-loop`, tick the item here with a one-line result + commit sha.
5. Blocked / 3 failed attempts → mark `[!]` with the blocker and move to the next item.
6. No paid API calls (AI adapters are verified offline against recorded fixtures / stub). No secrets in output.

## Done

- [x] **L0 — WebSocket auth + HTTP hardening.** WS upgrades now require a verified JWT/API key (`?token=`, `Authorization`, or `Sec-WebSocket-Protocol: bearer,<t>`); forged `X-User-Id` → 401 (was full account takeover of any user's event stream). Dev escape hatch `WS_ALLOW_HEADER_AUTH` refused in production. Helmet (API CSP `default-src 'none'`), validated + echoed `X-Request-Id`, `TRUST_PROXY`, server `headersTimeout`/`requestTimeout`/`keepAliveTimeout` (LB-aligned), `/livez` + `/readyz` (bounded 800 ms dep probes, 503 while draining), body-parser 400/413 no longer surface as 500. Probes in Helm/K8s/Dockerfile repointed. +34 tests.

- [x] **1. Graceful drain** (`8b215f5`). SIGTERM → `/readyz` 503 + `Connection: close` while still serving for `SHUTDOWN_DRAIN_DELAY_MS` → stop outbox/watchers → WS 1001 → HTTP close with idle sweep + force-close at deadline → release pools. Fixed `ws-server.close()` leaving live sockets open. Helm/compose grace periods aligned. In-flight shutdown 2.0 s → 0.24 s. 583 → 589 tests.
- [x] **2. Request-scoped context** (`10a6905`). AsyncLocalStorage per request (`request_id`, `user_id`, `auth_via`) auto-injected into every log line; recursive credential redaction in the logger; `http_request` access log with bounded route template, status, duration, 499 on abort, never the query string. 589 → 602 tests.
- [x] **3. W3C Trace Context** (`8adb9cf`). Dependency-free spec-compliant `traceparent`/`tracestate` handling; inbound traces continued with a new server span, invalid headers start a fresh trace; `trace_id`/`span_id` on every log line; `traceresponse` header (CORS-exposed); AI adapters propagate on outbound calls. OTel SDK deferred (propagator-compatible). 602 → 624 tests.
- [x] **4. Prometheus `/metrics`** (`c18a472`). prom-client per-bootstrap registry: RED histogram by route template, in-flight, outbox pending/age, WS connections, AI latency/outcome/tokens/circuit state, default runtime metrics. Timing-safe `METRICS_TOKEN` guard, fails closed in prod. Staging Prometheus scrape target now resolves. 624 → 633 tests.
- [x] **5. Real lint** (`cfba7dc`). ESLint 9 flat config (`@eslint/js` + `n` + `security`), `npm run lint` at zero warnings, CI job. Lint surfaced two real vulns, both fixed with tests: **path traversal in `LocalFsStorage`** and **ReDoS-prone `EMAIL_RE`** in the PII scrubber. 633 → 642 tests.
- [x] **6. Node LTS** (`16d7bc6`). Off EOL Node 18 → **Node 24 LTS** everywhere (Docker ×6, devcontainer, `.nvmrc`, workflows); `engines >=22.12`; CI backend matrix [22, 24]. Full suite verified on both. Tests unchanged at 642 (runtime-only change).
- [x] **7. Supply chain** (`efda201`). Prod advisories 7 (3 high) → 0; unused `uuid` dropped. All Actions SHA-pinned; least-privilege `permissions` everywhere; CodeQL; `npm audit` prod gate + dependency-review; CycloneDX SBOM in docker.yml; Dependabot (npm ×2, actions, docker). Policy test locks it in. 642 → 659 tests. *Deferred:* build provenance attestation needs a registry push first.
- [x] **8a. CI red-check triage** (`bf23d98`). CodeQL caught a **polynomial ReDoS in Bearer parsing** (`/^Bearer\s+(.+)$/i`, pre-existing in auth middleware) → linear `parseBearer()` everywhere. Actions bumped to Node-24 majors (still SHA-pinned). dependency-review non-blocking until the repo enables Dependency graph. Contract tests red on `main` too (pre-existing → #13).
- [x] **8. WebSocket hardening II** (`51170fc`). **Realtime delivery was broken in prod wiring** (in-memory test double registered with real sockets → `TypeError` on every push) — fixed with `WsBroadcaster`, E2E-proven. Idle-timer bug fixed. Path lock, Origin allow-list (CSWSH), per-user cap (429), maxPayload (1009), 4001 on token expiry, backpressure (1013). 659 → 684 tests.
- [x] **9. Frontend WS subprotocol auth** (`473769e`). Token moved from `?token=` to `Sec-WebSocket-Protocol: bearer,<token>`; `user_id` param dropped; 4001 → `onTokenExpired()` + immediate reconnect. Server pins negotiation to `bearer` (default would echo a misordered token). Frontend service tests now run in CI. Backend 684 → 686; frontend WS 6 → 12.
- [x] **10. Rate limiting** (`b8cf08b`). Was per-pod memory, per-IP only, `/register` + `/password` unlimited, global config unenforced. Now Redis-backed factory (draft-7 headers, IPv6 /64, hashed identifiers), per-account failed-login limit, register/password limits, auth fail-closed, general `/api/v1` budget (defaults 600/min). Also fixed a boot-time crash path (unhandled `SCRIPT LOAD` rejection with Redis down). 686 → 708 tests.
- [x] **11. RFC 9457** (`8bede0b`). One middleware turns every ≥400 JSON response into `application/problem+json` (`type`/`title`/`status`/`detail`/`instance` + `code`, `request_id`) while preserving all three legacy context envelopes as extension members — non-breaking, no router edits. 708 → 721 tests.
- [x] **12. AI adapter SOTA** (`ce7ccc7`). Anthropic forced tool use + OpenAI `json_schema` structured outputs from one shared JSON Schema (validator kept); prompt caching on the static prefix; `AI_MODEL_CLASSIFY` tier; label-set enforcement. Fixed two loop-4 telemetry bugs: vendor adapters dropped `onTelemetry`, and token counters read the wrong keys. Offline tests only. 721 → 729 tests.

## Backlog (priority order)

- [ ] **13. Contract tests un-skipped.** `jest.contracts.config.js` currently skips all 148 tests — make them run against the in-memory bootstrap and add to CI.
- [ ] **14. Type safety.** `checkJs` + JSDoc on `shared-kernel` and `bootstrap` first; real `npm run typecheck`; remove `continue-on-error`.
- [ ] **15. Coverage + mutation gates.** CI coverage report with per-context thresholds; Stryker on `*/domain` with a baseline mutation score.
