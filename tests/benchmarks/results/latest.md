# GUI-LOP Benchmark Results

Generated: 2026-05-11T22:07:34.954Z
Node: v22.22.2 (linux/x64)
Total elapsed: 17.41 s

SLO references: ADR 0021 (observability).

**Summary:** 25 PASS · 0 FAIL · 0 N/A (of 25 benches)

## domain-purity

| Scenario | Mean (ms) | p50 (ms) | p95 (ms) | p99 (ms) | OPS/sec | SLO | Status |
|---|---:|---:|---:|---:|---:|---|---|
| `workflow.next_action` | 0.001 | 0.001 | 0.002 | 0.010 | 461081.7 | p95 < 1 ms | PASS |
| `workflow.apply_human_response` | 0.032 | 0.009 | 0.015 | 0.037 | 31185.3 | p95 < 1 ms | PASS |
| `response_validation.validate` | 0.006 | 0.005 | 0.008 | 0.024 | 99842.3 | p95 < 1 ms | PASS |
| `authorisation.is_authorised` | 0.001 | 0.001 | 0.001 | 0.002 | 882927.4 | p95 < 1 ms | PASS |

## repository-throughput

| Scenario | Mean (ms) | p50 (ms) | p95 (ms) | p99 (ms) | OPS/sec | SLO | Status |
|---|---:|---:|---:|---:|---:|---|---|
| `workflow_repo.save` | 0.011 | 0.010 | 0.016 | 0.034 | 87631.8 | p95 < 5 ms | PASS |
| `workflow_repo.findById` | 0.016 | 0.013 | 0.017 | 0.030 | 63382.9 | p95 < 5 ms | PASS |
| `human_response_repo.save` | 0.010 | 0.009 | 0.015 | 0.031 | 98128.6 | p95 < 5 ms | PASS |
| `human_response_repo.findByIdempotencyKey` | 0.007 | 0.007 | 0.010 | 0.014 | 132730.3 | p95 < 5 ms | PASS |
| `outbox.enqueue` | 0.007 | 0.002 | 0.004 | 0.007 | 140548.0 | p95 < 1 ms | PASS |
| `outbox.pickBatch(100)` | 0.016 | 0.009 | 0.018 | 0.053 | 61851.5 | p95 < 5 ms | PASS |

## eventbus-throughput

| Scenario | Mean (ms) | p50 (ms) | p95 (ms) | p99 (ms) | OPS/sec | SLO | Status |
|---|---:|---:|---:|---:|---:|---|---|
| `outbox.publish[100]` | 0.662 | 0.602 | 0.694 | 1.954 | 1508.6 | drain p95 < 5 s | PASS |
| `outbox.publish[500]` | 4.354 | 4.009 | 6.663 | 6.759 | 229.6 | drain p95 < 5 s | PASS |
| `outbox.publish[1000]` | 12.900 | 12.398 | 15.380 | 15.580 | 77.5 | drain p95 < 5 s | PASS |
| `websocket.broadcast[10]` | 0.006 | 0.005 | 0.010 | 0.019 | 171097.5 | p99 < 1 s | PASS |
| `websocket.broadcast[100]` | 0.033 | 0.029 | 0.051 | 0.134 | 29764.0 | p99 < 1 s | PASS |
| `websocket.broadcast[500]` | 0.128 | 0.054 | 0.183 | 2.655 | 7766.7 | p99 < 1 s | PASS |

## workflow-throughput

| Scenario | Mean (ms) | p50 (ms) | p95 (ms) | p99 (ms) | OPS/sec | SLO | Status |
|---|---:|---:|---:|---:|---:|---|---|
| `workflow.create` | 1.582 | 1.482 | 1.964 | 3.548 | 631.6 | p95 < 250 ms | PASS |
| `workflow.execute` | 1.535 | 1.501 | 1.678 | 3.482 | 650.9 | p95 < 250 ms | PASS |
| `workflow.respond` | 1.743 | 1.660 | 2.080 | 3.935 | 573.1 | p95 < 250 ms | PASS |
| `workflow.detail` | 1.129 | 1.072 | 1.358 | 1.968 | 884.7 | p95 < 250 ms | PASS |
| `workflow.lifecycle` | 4.253 | 4.130 | 4.576 | 6.509 | 235.0 | p95 < 750 ms | PASS |

## auth-throughput

| Scenario | Mean (ms) | p50 (ms) | p95 (ms) | p99 (ms) | OPS/sec | SLO | Status |
|---|---:|---:|---:|---:|---:|---|---|
| `auth.register` | 72.427 | 72.184 | 73.442 | 75.868 | 13.8 | p95 < 250 ms | PASS |
| `auth.login` | 72.953 | 72.685 | 74.938 | 76.902 | 13.7 | p95 < 100 ms | PASS |
| `auth.refresh` | 1.193 | 1.131 | 1.455 | 1.642 | 837.0 | p95 < 50 ms | PASS |
| `auth.middleware` | 0.914 | 0.887 | 1.058 | 1.334 | 1091.8 | p95 < 10 ms | PASS |

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
