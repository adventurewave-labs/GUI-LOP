# GUI-LOP Benchmark Results

Generated: 2026-05-10T06:53:27.311Z
Node: v22.22.2 (linux/x64)
Total elapsed: 37.67 s

SLO references: ADR 0021 (observability).

**Summary:** 24 PASS · 1 FAIL · 0 N/A (of 25 benches)

## domain-purity

| Scenario | Mean (ms) | p50 (ms) | p95 (ms) | p99 (ms) | OPS/sec | SLO | Status |
|---|---:|---:|---:|---:|---:|---|---|
| `workflow.next_action` | 0.005 | 0.001 | 0.003 | 0.010 | 187460.7 | p95 < 1 ms | PASS |
| `workflow.apply_human_response` | 0.016 | 0.011 | 0.030 | 0.065 | 62930.8 | p95 < 1 ms | PASS |
| `response_validation.validate` | 0.009 | 0.007 | 0.015 | 0.039 | 110614.0 | p95 < 1 ms | PASS |
| `authorisation.is_authorised` | 0.001 | 0.001 | 0.003 | 0.007 | 588306.2 | p95 < 1 ms | PASS |

## repository-throughput

| Scenario | Mean (ms) | p50 (ms) | p95 (ms) | p99 (ms) | OPS/sec | SLO | Status |
|---|---:|---:|---:|---:|---:|---|---|
| `workflow_repo.save` | 0.021 | 0.015 | 0.044 | 0.091 | 45729.7 | p95 < 5 ms | PASS |
| `workflow_repo.findById` | 0.024 | 0.019 | 0.043 | 0.077 | 41512.0 | p95 < 5 ms | PASS |
| `human_response_repo.save` | 0.014 | 0.010 | 0.027 | 0.069 | 68811.0 | p95 < 5 ms | PASS |
| `human_response_repo.findByIdempotencyKey` | 0.010 | 0.008 | 0.017 | 0.038 | 98934.4 | p95 < 5 ms | PASS |
| `outbox.enqueue` | 0.004 | 0.003 | 0.007 | 0.015 | 267013.6 | p95 < 1 ms | PASS |
| `outbox.pickBatch(100)` | 0.025 | 0.010 | 0.022 | 0.067 | 39064.6 | p95 < 5 ms | PASS |

## eventbus-throughput

| Scenario | Mean (ms) | p50 (ms) | p95 (ms) | p99 (ms) | OPS/sec | SLO | Status |
|---|---:|---:|---:|---:|---:|---|---|
| `outbox.publish[100]` | 0.979 | 0.902 | 1.120 | 2.313 | 1020.2 | drain p95 < 5 s | PASS |
| `outbox.publish[500]` | 7.841 | 7.037 | 12.829 | 13.752 | 127.5 | drain p95 < 5 s | PASS |
| `outbox.publish[1000]` | 23.126 | 22.287 | 27.682 | 28.586 | 43.2 | drain p95 < 5 s | PASS |
| `websocket.broadcast[10]` | 0.007 | 0.006 | 0.008 | 0.026 | 145257.5 | p99 < 1 s | PASS |
| `websocket.broadcast[100]` | 0.059 | 0.034 | 0.068 | 0.207 | 16905.8 | p99 < 1 s | PASS |
| `websocket.broadcast[500]` | 0.230 | 0.129 | 0.221 | 3.418 | 4332.1 | p99 < 1 s | PASS |

## workflow-throughput

| Scenario | Mean (ms) | p50 (ms) | p95 (ms) | p99 (ms) | OPS/sec | SLO | Status |
|---|---:|---:|---:|---:|---:|---|---|
| `workflow.create` | 1.767 | 1.676 | 2.110 | 4.144 | 565.5 | p95 < 250 ms | PASS |
| `workflow.execute` | 1.970 | 1.902 | 2.225 | 5.050 | 507.4 | p95 < 250 ms | PASS |
| `workflow.respond` | 1.458 | 1.406 | 1.652 | 3.766 | 685.3 | p95 < 250 ms | PASS |
| `workflow.detail` | 1.272 | 1.208 | 1.535 | 2.232 | 785.5 | p95 < 250 ms | PASS |
| `workflow.lifecycle` | 4.502 | 4.321 | 4.920 | 7.684 | 222.1 | p95 < 750 ms | PASS |

## auth-throughput

| Scenario | Mean (ms) | p50 (ms) | p95 (ms) | p99 (ms) | OPS/sec | SLO | Status |
|---|---:|---:|---:|---:|---:|---|---|
| `auth.register` | 234.520 | 233.846 | 238.104 | 240.901 | 4.3 | p95 < 250 ms | PASS |
| `auth.login` | 236.700 | 235.103 | 245.734 | 255.686 | 4.2 | p95 < 100 ms | FAIL (+145.73 ms) |
| `auth.refresh` | 1.280 | 1.204 | 1.767 | 2.055 | 780.3 | p95 < 50 ms | PASS |
| `auth.middleware` | 1.056 | 1.005 | 1.302 | 2.267 | 945.6 | p95 < 10 ms | PASS |

## SLO budgets

| Bench | Metric | Budget |
|---|---|---|
| `workflow.detail` | p95 | p95 < 250 ms |
| `workflow.create` | p95 | p95 < 250 ms |
| `workflow.execute` | p95 | p95 < 250 ms |
| `workflow.respond` | p95 | p95 < 250 ms |
| `workflow.lifecycle` | p95 | p95 < 750 ms |
| `auth.login` | p95 | p95 < 100 ms |
| `auth.register` | p95 | p95 < 250 ms |
| `auth.refresh` | p95 | p95 < 50 ms |
| `auth.middleware` | p95 | p95 < 10 ms |
| `workflow_repo.save` | p95 | p95 < 5 ms |
| `workflow_repo.findById` | p95 | p95 < 5 ms |
| `human_response_repo.save` | p95 | p95 < 5 ms |
| `human_response_repo.findByIdempotencyKey` | p95 | p95 < 5 ms |
| `outbox.enqueue` | p95 | p95 < 1 ms |
| `outbox.pickBatch(100)` | p95 | p95 < 5 ms |
| `outbox.publish[100]` | p95 | drain p95 < 5 s |
| `outbox.publish[500]` | p95 | drain p95 < 5 s |
| `outbox.publish[1000]` | p95 | drain p95 < 5 s |
| `websocket.broadcast[10]` | p99 | p99 < 1 s |
| `websocket.broadcast[100]` | p99 | p99 < 1 s |
| `websocket.broadcast[500]` | p99 | p99 < 1 s |
| `workflow.next_action` | p95 | p95 < 1 ms |
| `workflow.apply_human_response` | p95 | p95 < 1 ms |
| `response_validation.validate` | p95 | p95 < 1 ms |
| `authorisation.is_authorised` | p95 | p95 < 1 ms |
