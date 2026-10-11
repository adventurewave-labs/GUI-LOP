# GUI-LOP Benchmark Results

Generated: 2026-10-11T17:48:27.887Z
Node: v24.21.0 (linux/x64)
Total elapsed: 36.45 s

SLO references: ADR 0021 (observability).

**Summary:** 24 PASS · 1 FAIL · 0 N/A (of 25 benches)

## domain-purity

| Scenario | Mean (ms) | p50 (ms) | p95 (ms) | p99 (ms) | OPS/sec | SLO | Status |
|---|---:|---:|---:|---:|---:|---|---|
| `workflow.next_action` | 0.005 | 0.001 | 0.010 | 0.056 | 188672.3 | p95 < 1 ms | PASS |
| `workflow.apply_human_response` | 0.038 | 0.023 | 0.066 | 0.342 | 25847.0 | p95 < 1 ms | PASS |
| `response_validation.validate` | 0.020 | 0.014 | 0.043 | 0.135 | 47529.4 | p95 < 1 ms | PASS |
| `authorisation.is_authorised` | 0.003 | 0.002 | 0.007 | 0.025 | 309450.7 | p95 < 1 ms | PASS |

## repository-throughput

| Scenario | Mean (ms) | p50 (ms) | p95 (ms) | p99 (ms) | OPS/sec | SLO | Status |
|---|---:|---:|---:|---:|---:|---|---|
| `workflow_repo.save` | 0.048 | 0.023 | 0.062 | 0.262 | 20728.5 | p95 < 5 ms | PASS |
| `workflow_repo.findById` | 0.047 | 0.032 | 0.061 | 0.190 | 20860.2 | p95 < 5 ms | PASS |
| `human_response_repo.save` | 0.015 | 0.011 | 0.027 | 0.100 | 62856.5 | p95 < 5 ms | PASS |
| `human_response_repo.findByIdempotencyKey` | 0.040 | 0.026 | 0.045 | 0.095 | 25037.2 | p95 < 5 ms | PASS |
| `outbox.enqueue` | 0.006 | 0.004 | 0.007 | 0.032 | 167762.8 | p95 < 1 ms | PASS |
| `outbox.pickBatch(100)` | 0.022 | 0.017 | 0.051 | 0.088 | 44568.1 | p95 < 5 ms | PASS |

## eventbus-throughput

| Scenario | Mean (ms) | p50 (ms) | p95 (ms) | p99 (ms) | OPS/sec | SLO | Status |
|---|---:|---:|---:|---:|---:|---|---|
| `outbox.publish[100]` | 1.930 | 1.496 | 2.381 | 10.007 | 516.8 | drain p95 < 5 s | PASS |
| `outbox.publish[500]` | 12.713 | 10.894 | 18.785 | 43.943 | 78.6 | drain p95 < 5 s | PASS |
| `outbox.publish[1000]` | 26.150 | 25.101 | 33.322 | 34.430 | 38.2 | drain p95 < 5 s | PASS |
| `websocket.broadcast[10]` | 0.017 | 0.011 | 0.045 | 0.098 | 56814.6 | p99 < 1 s | PASS |
| `websocket.broadcast[100]` | 0.107 | 0.051 | 0.159 | 0.549 | 9238.4 | p99 < 1 s | PASS |
| `websocket.broadcast[500]` | 0.221 | 0.137 | 0.255 | 1.197 | 4496.8 | p99 < 1 s | PASS |

## workflow-throughput

| Scenario | Mean (ms) | p50 (ms) | p95 (ms) | p99 (ms) | OPS/sec | SLO | Status |
|---|---:|---:|---:|---:|---:|---|---|
| `workflow.create` | 5.951 | 3.992 | 17.251 | 29.247 | 168.0 | p95 < 250 ms | PASS |
| `workflow.execute` | 4.392 | 3.510 | 7.263 | 18.032 | 227.5 | p95 < 250 ms | PASS |
| `workflow.respond` | 5.869 | 4.290 | 9.594 | 23.763 | 170.3 | p95 < 250 ms | PASS |
| `workflow.detail` | 3.251 | 2.627 | 5.231 | 8.781 | 307.5 | p95 < 250 ms | PASS |
| `workflow.lifecycle` | 12.835 | 11.568 | 19.700 | 32.764 | 77.9 | p95 < 750 ms | PASS |

## auth-throughput

| Scenario | Mean (ms) | p50 (ms) | p95 (ms) | p99 (ms) | OPS/sec | SLO | Status |
|---|---:|---:|---:|---:|---:|---|---|
| `auth.register` | 88.706 | 83.759 | 113.582 | 181.903 | 11.3 | p95 < 250 ms | PASS |
| `auth.login` | 85.104 | 83.178 | 103.799 | 119.100 | 11.7 | p95 < 100 ms | FAIL (+3.80 ms) |
| `auth.refresh` | 3.660 | 3.163 | 6.759 | 9.455 | 273.0 | p95 < 50 ms | PASS |
| `auth.middleware` | 2.852 | 2.066 | 5.403 | 15.074 | 350.4 | p95 < 10 ms | PASS |

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
