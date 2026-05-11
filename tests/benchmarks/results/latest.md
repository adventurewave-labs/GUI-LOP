# GUI-LOP Benchmark Results

Generated: 2026-05-11T21:13:38.630Z
Node: v22.22.2 (linux/x64)
Total elapsed: 16.07 s

SLO references: ADR 0021 (observability).

**Summary:** 25 PASS · 0 FAIL · 0 N/A (of 25 benches)

## domain-purity

| Scenario | Mean (ms) | p50 (ms) | p95 (ms) | p99 (ms) | OPS/sec | SLO | Status |
|---|---:|---:|---:|---:|---:|---|---|
| `workflow.next_action` | 0.001 | 0.001 | 0.002 | 0.008 | 622977.7 | p95 < 1 ms | PASS |
| `workflow.apply_human_response` | 0.036 | 0.010 | 0.019 | 0.042 | 27374.7 | p95 < 1 ms | PASS |
| `response_validation.validate` | 0.012 | 0.006 | 0.010 | 0.034 | 82540.2 | p95 < 1 ms | PASS |
| `authorisation.is_authorised` | 0.001 | 0.001 | 0.002 | 0.003 | 837929.4 | p95 < 1 ms | PASS |

## repository-throughput

| Scenario | Mean (ms) | p50 (ms) | p95 (ms) | p99 (ms) | OPS/sec | SLO | Status |
|---|---:|---:|---:|---:|---:|---|---|
| `workflow_repo.save` | 0.013 | 0.011 | 0.020 | 0.061 | 77319.3 | p95 < 5 ms | PASS |
| `workflow_repo.findById` | 0.021 | 0.014 | 0.019 | 0.045 | 47281.2 | p95 < 5 ms | PASS |
| `human_response_repo.save` | 0.011 | 0.009 | 0.015 | 0.051 | 93168.8 | p95 < 5 ms | PASS |
| `human_response_repo.findByIdempotencyKey` | 0.007 | 0.007 | 0.009 | 0.014 | 138380.5 | p95 < 5 ms | PASS |
| `outbox.enqueue` | 0.009 | 0.003 | 0.004 | 0.011 | 114517.8 | p95 < 1 ms | PASS |
| `outbox.pickBatch(100)` | 0.016 | 0.008 | 0.016 | 0.047 | 63177.2 | p95 < 5 ms | PASS |

## eventbus-throughput

| Scenario | Mean (ms) | p50 (ms) | p95 (ms) | p99 (ms) | OPS/sec | SLO | Status |
|---|---:|---:|---:|---:|---:|---|---|
| `outbox.publish[100]` | 0.746 | 0.657 | 0.943 | 2.369 | 1339.5 | drain p95 < 5 s | PASS |
| `outbox.publish[500]` | 5.186 | 4.369 | 7.785 | 11.614 | 192.7 | drain p95 < 5 s | PASS |
| `outbox.publish[1000]` | 12.901 | 12.155 | 15.748 | 16.163 | 77.5 | drain p95 < 5 s | PASS |
| `websocket.broadcast[10]` | 0.006 | 0.005 | 0.009 | 0.043 | 153628.6 | p99 < 1 s | PASS |
| `websocket.broadcast[100]` | 0.033 | 0.030 | 0.057 | 0.106 | 30105.0 | p99 < 1 s | PASS |
| `websocket.broadcast[500]` | 0.162 | 0.054 | 0.195 | 5.326 | 6164.2 | p99 < 1 s | PASS |

## workflow-throughput

| Scenario | Mean (ms) | p50 (ms) | p95 (ms) | p99 (ms) | OPS/sec | SLO | Status |
|---|---:|---:|---:|---:|---:|---|---|
| `workflow.create` | 1.424 | 1.312 | 1.838 | 3.152 | 701.5 | p95 < 250 ms | PASS |
| `workflow.execute` | 1.419 | 1.364 | 1.639 | 3.687 | 704.3 | p95 < 250 ms | PASS |
| `workflow.respond` | 1.666 | 1.578 | 2.032 | 4.107 | 599.7 | p95 < 250 ms | PASS |
| `workflow.detail` | 1.083 | 1.022 | 1.377 | 1.643 | 922.7 | p95 < 250 ms | PASS |
| `workflow.lifecycle` | 4.125 | 3.853 | 5.695 | 6.762 | 242.3 | p95 < 750 ms | PASS |

## auth-throughput

| Scenario | Mean (ms) | p50 (ms) | p95 (ms) | p99 (ms) | OPS/sec | SLO | Status |
|---|---:|---:|---:|---:|---:|---|---|
| `auth.register` | 63.468 | 63.280 | 64.654 | 65.701 | 15.8 | p95 < 250 ms | PASS |
| `auth.login` | 64.455 | 64.085 | 66.389 | 67.439 | 15.5 | p95 < 100 ms | PASS |
| `auth.refresh` | 1.114 | 1.072 | 1.294 | 1.448 | 896.4 | p95 < 50 ms | PASS |
| `auth.middleware` | 0.943 | 0.879 | 1.327 | 1.786 | 1059.4 | p95 < 10 ms | PASS |

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
