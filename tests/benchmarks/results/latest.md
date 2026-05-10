# GUI-LOP Benchmark Results

Generated: 2026-05-10T13:11:48.712Z
Node: v22.22.2 (linux/x64)
Total elapsed: 16.17 s

SLO references: ADR 0021 (observability).

**Summary:** 25 PASS · 0 FAIL · 0 N/A (of 25 benches)

## domain-purity

| Scenario | Mean (ms) | p50 (ms) | p95 (ms) | p99 (ms) | OPS/sec | SLO | Status |
|---|---:|---:|---:|---:|---:|---|---|
| `workflow.next_action` | 0.001 | 0.001 | 0.001 | 0.008 | 661288.6 | p95 < 1 ms | PASS |
| `workflow.apply_human_response` | 0.023 | 0.007 | 0.013 | 0.031 | 42505.2 | p95 < 1 ms | PASS |
| `response_validation.validate` | 0.007 | 0.004 | 0.006 | 0.021 | 132529.2 | p95 < 1 ms | PASS |
| `authorisation.is_authorised` | 0.001 | 0.001 | 0.001 | 0.002 | 957592.1 | p95 < 1 ms | PASS |

## repository-throughput

| Scenario | Mean (ms) | p50 (ms) | p95 (ms) | p99 (ms) | OPS/sec | SLO | Status |
|---|---:|---:|---:|---:|---:|---|---|
| `workflow_repo.save` | 0.010 | 0.009 | 0.014 | 0.033 | 95792.4 | p95 < 5 ms | PASS |
| `workflow_repo.findById` | 0.015 | 0.012 | 0.017 | 0.038 | 64167.1 | p95 < 5 ms | PASS |
| `human_response_repo.save` | 0.009 | 0.007 | 0.012 | 0.034 | 113228.4 | p95 < 5 ms | PASS |
| `human_response_repo.findByIdempotencyKey` | 0.007 | 0.007 | 0.009 | 0.014 | 133911.1 | p95 < 5 ms | PASS |
| `outbox.enqueue` | 0.002 | 0.002 | 0.002 | 0.006 | 442388.2 | p95 < 1 ms | PASS |
| `outbox.pickBatch(100)` | 0.013 | 0.008 | 0.011 | 0.039 | 78144.9 | p95 < 5 ms | PASS |

## eventbus-throughput

| Scenario | Mean (ms) | p50 (ms) | p95 (ms) | p99 (ms) | OPS/sec | SLO | Status |
|---|---:|---:|---:|---:|---:|---|---|
| `outbox.publish[100]` | 0.587 | 0.549 | 0.654 | 1.471 | 1702.5 | drain p95 < 5 s | PASS |
| `outbox.publish[500]` | 3.949 | 3.674 | 5.602 | 6.435 | 253.1 | drain p95 < 5 s | PASS |
| `outbox.publish[1000]` | 11.466 | 11.141 | 13.018 | 13.081 | 87.2 | drain p95 < 5 s | PASS |
| `websocket.broadcast[10]` | 0.017 | 0.005 | 0.008 | 0.037 | 59917.0 | p99 < 1 s | PASS |
| `websocket.broadcast[100]` | 0.037 | 0.026 | 0.046 | 0.109 | 26812.8 | p99 < 1 s | PASS |
| `websocket.broadcast[500]` | 0.088 | 0.048 | 0.142 | 0.795 | 11278.6 | p99 < 1 s | PASS |

## workflow-throughput

| Scenario | Mean (ms) | p50 (ms) | p95 (ms) | p99 (ms) | OPS/sec | SLO | Status |
|---|---:|---:|---:|---:|---:|---|---|
| `workflow.create` | 1.417 | 1.365 | 1.664 | 2.719 | 705.2 | p95 < 250 ms | PASS |
| `workflow.execute` | 1.438 | 1.398 | 1.583 | 2.904 | 694.8 | p95 < 250 ms | PASS |
| `workflow.respond` | 1.472 | 1.431 | 1.646 | 3.140 | 678.7 | p95 < 250 ms | PASS |
| `workflow.detail` | 1.051 | 1.027 | 1.166 | 1.718 | 950.6 | p95 < 250 ms | PASS |
| `workflow.lifecycle` | 4.030 | 3.905 | 4.996 | 5.713 | 248.0 | p95 < 750 ms | PASS |

## auth-throughput

| Scenario | Mean (ms) | p50 (ms) | p95 (ms) | p99 (ms) | OPS/sec | SLO | Status |
|---|---:|---:|---:|---:|---:|---|---|
| `auth.register` | 68.052 | 68.186 | 69.419 | 71.484 | 14.7 | p95 < 250 ms | PASS |
| `auth.login` | 68.339 | 67.858 | 71.942 | 73.150 | 14.6 | p95 < 100 ms | PASS |
| `auth.refresh` | 1.070 | 1.048 | 1.167 | 1.207 | 933.4 | p95 < 50 ms | PASS |
| `auth.middleware` | 0.884 | 0.847 | 1.069 | 1.460 | 1128.7 | p95 < 10 ms | PASS |

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
