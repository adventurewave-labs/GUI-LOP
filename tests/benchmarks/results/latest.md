# GUI-LOP Benchmark Results

Generated: 2026-05-10T07:09:34.832Z
Node: v22.22.2 (linux/x64)
Total elapsed: 16.98 s

SLO references: ADR 0021 (observability).

**Summary:** 25 PASS · 0 FAIL · 0 N/A (of 25 benches)

## domain-purity

| Scenario | Mean (ms) | p50 (ms) | p95 (ms) | p99 (ms) | OPS/sec | SLO | Status |
|---|---:|---:|---:|---:|---:|---|---|
| `workflow.next_action` | 0.004 | 0.001 | 0.003 | 0.009 | 210517.0 | p95 < 1 ms | PASS |
| `workflow.apply_human_response` | 0.049 | 0.013 | 0.026 | 0.053 | 20275.8 | p95 < 1 ms | PASS |
| `response_validation.validate` | 0.015 | 0.007 | 0.014 | 0.034 | 67111.4 | p95 < 1 ms | PASS |
| `authorisation.is_authorised` | 0.001 | 0.001 | 0.002 | 0.003 | 694623.9 | p95 < 1 ms | PASS |

## repository-throughput

| Scenario | Mean (ms) | p50 (ms) | p95 (ms) | p99 (ms) | OPS/sec | SLO | Status |
|---|---:|---:|---:|---:|---:|---|---|
| `workflow_repo.save` | 0.015 | 0.012 | 0.024 | 0.072 | 66848.7 | p95 < 5 ms | PASS |
| `workflow_repo.findById` | 0.020 | 0.018 | 0.029 | 0.059 | 49434.5 | p95 < 5 ms | PASS |
| `human_response_repo.save` | 0.020 | 0.010 | 0.022 | 0.067 | 49180.4 | p95 < 5 ms | PASS |
| `human_response_repo.findByIdempotencyKey` | 0.015 | 0.013 | 0.022 | 0.043 | 66917.3 | p95 < 5 ms | PASS |
| `outbox.enqueue` | 0.012 | 0.003 | 0.007 | 0.014 | 84431.6 | p95 < 1 ms | PASS |
| `outbox.pickBatch(100)` | 0.021 | 0.011 | 0.016 | 0.053 | 46303.9 | p95 < 5 ms | PASS |

## eventbus-throughput

| Scenario | Mean (ms) | p50 (ms) | p95 (ms) | p99 (ms) | OPS/sec | SLO | Status |
|---|---:|---:|---:|---:|---:|---|---|
| `outbox.publish[100]` | 0.965 | 0.848 | 0.992 | 3.215 | 1034.8 | drain p95 < 5 s | PASS |
| `outbox.publish[500]` | 7.340 | 6.669 | 11.616 | 12.112 | 136.2 | drain p95 < 5 s | PASS |
| `outbox.publish[1000]` | 21.821 | 20.803 | 26.130 | 26.895 | 45.8 | drain p95 < 5 s | PASS |
| `websocket.broadcast[10]` | 0.007 | 0.006 | 0.009 | 0.025 | 145082.6 | p99 < 1 s | PASS |
| `websocket.broadcast[100]` | 0.034 | 0.033 | 0.074 | 0.099 | 29365.9 | p99 < 1 s | PASS |
| `websocket.broadcast[500]` | 0.180 | 0.069 | 0.203 | 4.727 | 5552.8 | p99 < 1 s | PASS |

## workflow-throughput

| Scenario | Mean (ms) | p50 (ms) | p95 (ms) | p99 (ms) | OPS/sec | SLO | Status |
|---|---:|---:|---:|---:|---:|---|---|
| `workflow.create` | 1.594 | 1.523 | 1.894 | 3.834 | 626.8 | p95 < 250 ms | PASS |
| `workflow.execute` | 1.615 | 1.539 | 1.916 | 4.216 | 618.5 | p95 < 250 ms | PASS |
| `workflow.respond` | 1.708 | 1.646 | 1.929 | 3.901 | 584.9 | p95 < 250 ms | PASS |
| `workflow.detail` | 1.165 | 1.133 | 1.259 | 1.843 | 857.1 | p95 < 250 ms | PASS |
| `workflow.lifecycle` | 4.329 | 4.097 | 5.450 | 7.405 | 230.9 | p95 < 750 ms | PASS |

## auth-throughput

| Scenario | Mean (ms) | p50 (ms) | p95 (ms) | p99 (ms) | OPS/sec | SLO | Status |
|---|---:|---:|---:|---:|---:|---|---|
| `auth.register` | 60.363 | 60.174 | 61.627 | 62.349 | 16.6 | p95 < 250 ms | PASS |
| `auth.login` | 60.331 | 60.066 | 61.884 | 62.461 | 16.6 | p95 < 100 ms | PASS |
| `auth.refresh` | 1.320 | 1.276 | 1.489 | 1.737 | 757.0 | p95 < 50 ms | PASS |
| `auth.middleware` | 1.040 | 0.971 | 1.405 | 1.727 | 960.2 | p95 < 10 ms | PASS |

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
