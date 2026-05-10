/**
 * repository-throughput.bench.js — direct repository hammering, no HTTP.
 *
 * Builds the in-memory adapters used by the bootstrap composition root and
 * measures the cost of the read/write hot paths on each:
 *
 *   - workflow_repo.save / findById
 *   - human_response_repo.save / findByIdempotencyKey
 *   - outbox.enqueue / pickBatch(100)
 *
 * No HTTP, no auth, no use cases. The numbers reported here are the lower
 * bound on what every API call has to spend in persistence.
 */

import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

import { systemClock } from '../../../src/backend/shared-kernel/infrastructure/system-clock.js';
import { uuidGenerator } from '../../../src/backend/shared-kernel/infrastructure/uuid-generator.js';
import { InMemoryOutbox } from '../../../src/backend/shared-kernel/infrastructure/inmemory-outbox.js';

import { InMemoryWorkflowRepository } from '../../../src/backend/contexts/workflow-orchestration/infrastructure/persistence/inmemory-workflow-repository.js';
import { InMemoryWorkflowTemplateRepository } from '../../../src/backend/contexts/workflow-orchestration/infrastructure/persistence/inmemory-workflow-template-repository.js';
import { Workflow } from '../../../src/backend/contexts/workflow-orchestration/domain/workflow/workflow.js';
import { WorkflowTemplate } from '../../../src/backend/contexts/workflow-orchestration/domain/template/workflow-template.js';

import { InMemoryHumanResponseRepository } from '../../../src/backend/contexts/human-interaction/infrastructure/persistence/inmemory-human-response-repository.js';
import { HumanResponse } from '../../../src/backend/contexts/human-interaction/domain/human-response/human-response.js';
import { ResponseValidationService } from '../../../src/backend/contexts/human-interaction/domain/services/response-validation-service.js';

import { runStandalone } from '../runner.js';

const WARMUP = 100;
const ITERATIONS = 1000;

/* ---------------- fixtures ---------------- */

function buildTemplate() {
  const now = new Date();
  const template = WorkflowTemplate.draft({
    key: 'bench-template',
    version: 1,
    name: 'Bench Template',
    description: 'Used by the repository benchmarks',
    defaultConfig: {},
    now,
  });
  template.addStep({ name: 'Ingest', kind: 'automated' }, now);
  template.addStep({ name: 'Analyse', kind: 'automated' }, now);
  template.addStep({ name: 'Review', kind: 'human' }, now);
  template.publish({ now });
  return template;
}

function buildWorkflow(template) {
  return Workflow.createFromTemplate({
    id: uuidGenerator.next(),
    template,
    context: { tiny: true },
    createdBy: 'bench-user',
    now: new Date(),
    stepIdGen: { next: () => uuidGenerator.next() },
    actor: { id: 'bench-user', type: 'user' },
  });
}

function buildResponse({ workflowId, stepId, idempotencyKey }) {
  return HumanResponse.record({
    id: uuidGenerator.next(),
    workflowId,
    stepId,
    responder: 'bench-user',
    action: 'approve',
    payload: { ok: true },
    idempotencyKey,
    now: new Date(),
    validator: ResponseValidationService.forStep({ allowedActions: ['approve'] }),
  });
}

/* ---------------- bench builder ---------------- */

export function buildRepositoryBenches() {
  // Per-bench fixtures.
  const workflowRepo = new InMemoryWorkflowRepository();
  const templateRepo = new InMemoryWorkflowTemplateRepository();
  const responseRepo = new InMemoryHumanResponseRepository();
  const outbox = new InMemoryOutbox();

  // Pre-built immutable fixtures.
  let template = null;
  const preSavedWorkflowIds = [];

  return [
    {
      name: 'workflow_repo.save',
      warmup: WARMUP,
      iterations: ITERATIONS,
      async setup() {
        template = buildTemplate();
        await templateRepo.save(template);
      },
      async fn() {
        const wf = buildWorkflow(template);
        await workflowRepo.save(wf);
      },
    },

    {
      name: 'workflow_repo.findById',
      warmup: WARMUP,
      iterations: ITERATIONS,
      async setup() {
        if (!template) {
          template = buildTemplate();
          await templateRepo.save(template);
        }
        // Pre-populate a stable working set.
        for (let i = 0; i < 32; i += 1) {
          const wf = buildWorkflow(template);
          // eslint-disable-next-line no-await-in-loop
          await workflowRepo.save(wf);
          preSavedWorkflowIds.push(wf.id);
        }
        return { cursor: 0 };
      },
      async fn(state) {
        const id = preSavedWorkflowIds[state.cursor++ % preSavedWorkflowIds.length];
        await workflowRepo.findById(id);
      },
    },

    {
      name: 'human_response_repo.save',
      warmup: WARMUP,
      iterations: ITERATIONS,
      async setup() {
        return { i: 0 };
      },
      async fn(state) {
        const i = state.i++;
        const response = buildResponse({
          workflowId: `wf-${i}`,
          stepId: `step-${i}`,
          idempotencyKey: `key-${i}`,
        });
        await responseRepo.save(response);
      },
    },

    {
      name: 'human_response_repo.findByIdempotencyKey',
      warmup: WARMUP,
      iterations: ITERATIONS,
      async setup() {
        // Seed responses across N workflows so the linear scan in the
        // in-memory adapter has realistic length. Looking up the LAST
        // inserted entry maximises the worst-case (full scan).
        const seed = 256;
        const samples = [];
        for (let i = 0; i < seed; i += 1) {
          const workflowId = `seed-wf-${i}`;
          const stepId = `seed-step-${i}`;
          const idempotencyKey = `seed-key-${i}`;
          // eslint-disable-next-line no-await-in-loop
          await responseRepo.save(buildResponse({ workflowId, stepId, idempotencyKey }));
          samples.push({ workflowId, stepId, idempotencyKey });
        }
        return { samples, cursor: 0 };
      },
      async fn(state) {
        const s = state.samples[state.cursor++ % state.samples.length];
        await responseRepo.findByIdempotencyKey(s.workflowId, s.stepId, s.idempotencyKey);
      },
    },

    {
      name: 'outbox.enqueue',
      warmup: WARMUP,
      iterations: ITERATIONS,
      async fn() {
        await outbox.enqueue([
          {
            toJSON() {
              return {
                eventId: randomUUID(),
                eventType: 'bench.event',
                eventVersion: 1,
                aggregateId: randomUUID(),
                aggregateType: 'BenchAggregate',
                payload: { value: 42 },
                occurredAt: new Date().toISOString(),
              };
            },
          },
        ]);
      },
    },

    {
      name: 'outbox.pickBatch(100)',
      warmup: 50,
      iterations: 500,
      async setup() {
        // Make sure there are enough pending records for every iteration.
        // The bench reads the same backing array each time without consuming;
        // pickBatch returns copies and never mutates state.
        const local = new InMemoryOutbox();
        for (let i = 0; i < 1000; i += 1) {
          // eslint-disable-next-line no-await-in-loop
          await local.enqueue([
            {
              toJSON() {
                return {
                  eventId: randomUUID(),
                  eventType: 'bench.event',
                  eventVersion: 1,
                  aggregateId: randomUUID(),
                  aggregateType: 'BenchAggregate',
                  payload: { value: i },
                  occurredAt: new Date().toISOString(),
                };
              },
            },
          ]);
        }
        return { outbox: local };
      },
      async fn(state) {
        await state.outbox.pickBatch(100);
      },
    },
  ];
}

/* ---------------- standalone entry ---------------- */

async function main() {
  await runStandalone('repository-throughput', () => buildRepositoryBenches());
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('repository-throughput bench failed:', err);
    process.exit(1);
  });
}

// keep references to silence "unused import" linters; they're load-bearing fixtures.
void systemClock;
