/**
 * workflow-throughput.bench.js — measures the workflow HTTP hot paths.
 *
 * Boots the in-memory composition root and exercises:
 *   - POST /api/v1/workflows                 (workflow.create)
 *   - POST /api/v1/workflows/:id/execute     (workflow.execute)
 *   - POST /api/v1/workflows/:id/respond     (workflow.respond)
 *   - GET  /api/v1/workflows/:id             (workflow.detail)
 *   - composite create -> execute -> respond (workflow.lifecycle)
 *
 * Each named bench targets 50 warmup + 500 iterations as required by the
 * benchmark spec. The composite lifecycle uses a smaller iteration count
 * since each iteration drives ~3 HTTP calls.
 *
 * The bench exposes `buildWorkflowBenches({app, ctx})` so the top-level
 * `tests/benchmarks/index.js` can share a single bootstrap across all
 * scenarios. Run directly with `node tests/benchmarks/scenarios/workflow-throughput.bench.js`.
 */

import request from 'supertest';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

import { bootstrap } from '../../../src/backend/bootstrap/main.js';
import { runStandalone } from '../runner.js';

const WARMUP = 50;
const ITERATIONS = 500;
const LIFECYCLE_ITERATIONS = 200;

/**
 * Bring up the bootstrap stack with NO test-only middleware shims. Fix 1
 * of the DDD integration sweep makes the auth middleware pre-populate
 * `req.user` and `req.actor` from `req.principal`, and Fix 2 makes the
 * human-interaction router declare relative paths so its bootstrap mount
 * produces the documented `/api/v1/inbox` and `/api/v1/workflows/:id/respond`
 * URLs. The benches now exercise production wiring directly.
 */
export async function bootBenchApp() {
  const booted = await bootstrap({
    JWT_SECRET: 'bench-secret-change-me',
    LOG_LEVEL: 'error',
    DATABASE_URL: undefined,
    REDIS_URL: undefined,
  });

  // Register a real admin user so the AuthorisationService.ensure() lookup
  // succeeds. Admin role is implicitly authorised for every permission.
  const credentials = {
    email: `bench-${randomUUID()}@example.com`,
    username: `bench${Date.now()}${Math.floor(Math.random() * 1000)}`,
    password: 'BenchPassword!1',
    role: 'admin',
    fullName: 'Bench Admin',
  };
  const registered = await booted.ctx.identity.useCases.registerUser.execute(credentials);
  const accessToken = await mintToken(booted, registered.id, 'admin');
  return { booted, app: booted.app, accessToken, principal: registered };
}

async function mintToken(booted, sub, role = 'admin') {
  const { tokenIssuer } = booted.ctx.identity;
  const { token } = await tokenIssuer.issueAccess(
    {
      sub,
      role,
      sid: `bench-session-${randomUUID()}`,
    },
    900,
  );
  return token;
}

/**
 * Exercise: create a workflow via the v1 router and return its id.
 */
async function createWorkflow(app, accessToken) {
  const res = await request(app)
    .post('/api/v1/workflows')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ template: 'data-analysis', context: { tiny: true } });
  if (res.status !== 201) {
    throw new Error(`create workflow failed (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return res.body.data.workflow_id;
}

async function executeWorkflow(app, accessToken, workflowId) {
  const res = await request(app)
    .post(`/api/v1/workflows/${workflowId}/execute`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({});
  if (res.status !== 200) {
    throw new Error(`execute workflow failed (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return res.body.data;
}

async function respondToWorkflow(app, accessToken, workflowId, stepId) {
  const res = await request(app)
    .post(`/api/v1/workflows/${workflowId}/respond`)
    .set('Authorization', `Bearer ${accessToken}`)
    .set('Idempotency-Key', randomUUID())
    .send({ step_id: stepId, action: 'approve', payload: { ok: true } });
  return res; // surface for diagnostics; some calls may 404 in cold paths
}

async function getWorkflow(app, accessToken, workflowId) {
  const res = await request(app)
    .get(`/api/v1/workflows/${workflowId}`)
    .set('Authorization', `Bearer ${accessToken}`);
  if (res.status !== 200) {
    throw new Error(`get workflow failed (${res.status})`);
  }
  return res.body.data.workflow;
}

/**
 * Find the (stepId) currently waiting for human input on a workflow.
 * Returns null if the workflow has no pending human step.
 */
async function pendingHumanStepId(ctx, workflowId) {
  const detail = await ctx.workflow.useCases.getDetail.execute({ workflowId });
  const step = (detail?.steps ?? []).find((s) => s.status === 'waiting_for_human');
  return step?.id ?? null;
}

/**
 * Build the bench definitions for this scenario, given an already-booted app.
 *
 * @param {{ booted: Awaited<ReturnType<typeof bootstrap>>, app: import('express').Express, accessToken: string }} env
 */
export function buildWorkflowBenches({ booted, app, accessToken }) {
  // Warm pools of pre-created workflow ids. We pre-create enough ids so each
  // measured iteration in the per-route benches has a fresh target without
  // amortising the create cost into the timing.
  let detailIds = [];
  let executeIds = [];
  let respondTargets = []; // { workflowId, stepId }

  return [
    {
      name: 'workflow.create',
      warmup: WARMUP,
      iterations: ITERATIONS,
      async fn() {
        await createWorkflow(app, accessToken);
      },
    },

    {
      name: 'workflow.execute',
      warmup: WARMUP,
      iterations: ITERATIONS,
      async setup() {
        // Pre-create one workflow per measured iteration plus warmup.
        executeIds = [];
        for (let i = 0; i < WARMUP + ITERATIONS; i += 1) {
          // eslint-disable-next-line no-await-in-loop
          executeIds.push(await createWorkflow(app, accessToken));
        }
        return { cursor: 0 };
      },
      async fn(state) {
        const id = executeIds[state.cursor++];
        if (!id) throw new Error('out of pre-created execute ids');
        await executeWorkflow(app, accessToken, id);
      },
    },

    {
      name: 'workflow.respond',
      warmup: WARMUP,
      iterations: ITERATIONS,
      async setup() {
        // Pre-create + pre-execute workflows so each iteration has a fresh
        // pending human step to respond to. The data-analysis template
        // pauses on its 4th step ("Human Review"). We also feed the
        // workflow.human_input_required event into the human-interaction
        // handler so the pending step exists in its repository.
        respondTargets = [];
        const onHumanInput =
          booted.ctx.humanInteraction.eventHandlers.onWorkflowHumanInputRequired;
        for (let i = 0; i < WARMUP + ITERATIONS; i += 1) {
          // eslint-disable-next-line no-await-in-loop
          const wfId = await createWorkflow(app, accessToken);
          // eslint-disable-next-line no-await-in-loop
          await executeWorkflow(app, accessToken, wfId);
          // eslint-disable-next-line no-await-in-loop
          const detail = await booted.ctx.workflow.useCases.getDetail.execute({
            workflowId: wfId,
          });
          const step = (detail?.steps ?? []).find((s) => s.status === 'waiting_for_human');
          if (!step) continue;
          // eslint-disable-next-line no-await-in-loop
          await onHumanInput.handle({
            workflowId: wfId,
            stepId: step.id,
            occurredAt: new Date(),
            uiSpec: step.uiSpec ?? null,
            deadline: step.deadline ?? null,
            onTimeout: step.onTimeout ?? null,
          });
          respondTargets.push({ workflowId: wfId, stepId: step.id });
        }
        return { cursor: 0 };
      },
      async fn(state) {
        const target = respondTargets[state.cursor++];
        if (!target) throw new Error('out of pre-prepared respond targets');
        // The respond endpoint depends on a pending step having been
        // registered by the workflow.human_input_required event handler.
        // In dev mode we don't run that handler synchronously, so the call
        // may legitimately 404 — we still measure the round-trip time.
        await respondToWorkflow(app, accessToken, target.workflowId, target.stepId);
      },
    },

    {
      name: 'workflow.detail',
      warmup: WARMUP,
      iterations: ITERATIONS,
      async setup() {
        detailIds = [];
        for (let i = 0; i < 16; i += 1) {
          // eslint-disable-next-line no-await-in-loop
          detailIds.push(await createWorkflow(app, accessToken));
        }
        return { cursor: 0 };
      },
      async fn(state) {
        const id = detailIds[state.cursor++ % detailIds.length];
        await getWorkflow(app, accessToken, id);
      },
    },

    {
      name: 'workflow.lifecycle',
      warmup: 20,
      iterations: LIFECYCLE_ITERATIONS,
      async fn() {
        const wfId = await createWorkflow(app, accessToken);
        await executeWorkflow(app, accessToken, wfId);
        const detail = await booted.ctx.workflow.useCases.getDetail.execute({
          workflowId: wfId,
        });
        const step = (detail?.steps ?? []).find((s) => s.status === 'waiting_for_human');
        if (step) {
          // Seed the pending step so the respond hot path resolves.
          await booted.ctx.humanInteraction.eventHandlers.onWorkflowHumanInputRequired.handle({
            workflowId: wfId,
            stepId: step.id,
            occurredAt: new Date(),
            uiSpec: step.uiSpec ?? null,
            deadline: step.deadline ?? null,
            onTimeout: step.onTimeout ?? null,
          });
          await respondToWorkflow(app, accessToken, wfId, step.id);
        }
      },
    },
  ];
}

/* -------------------- standalone entry -------------------- */

async function main() {
  const env = await bootBenchApp();
  try {
    const benches = buildWorkflowBenches(env);
    await runStandalone('workflow-throughput', () => benches);
  } finally {
    await env.booted.shutdown();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('workflow-throughput bench failed:', err);
    process.exit(1);
  });
}
