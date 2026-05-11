/**
 * Integration test: end-to-end workflow completion through human response.
 *
 * Boots the app in-memory (no DATABASE_URL), seeds an admin user, creates
 * a `data-analysis` workflow (whose final step is a human review), and
 * exercises the full lifecycle:
 *
 *   1. POST /api/v1/workflows           -> created
 *   2. POST /api/v1/workflows/:id/execute -> waiting_for_human
 *   3. POST /api/v1/workflows/:id/respond -> resumes + completes
 *
 * Asserts:
 *   - The workflow transitions waiting_for_human -> running -> completed
 *     (running is observed implicitly via the lifecycle events emitted by
 *     `applyHumanResponse`, which transitions waiting_for_human -> running
 *     before recording the step output and completing the workflow).
 *   - The in-memory WebSocket broadcaster received the full event sequence
 *     including the terminal `workflow.completed` envelope. This is what
 *     was missing prior to the iteration-3 fix: `AdvanceWorkflowUseCase`
 *     used to ignore `{stepId, response}`, so the engine saw the workflow
 *     still parked on `waiting_for_human` and never reached `completed`.
 */

import request from 'supertest';
import { bootstrap } from '../../src/backend/bootstrap/main.js';
import { Channel } from '../../src/backend/contexts/notification/domain/subscription/channel.js';
import { EndpointAddress } from '../../src/backend/contexts/notification/domain/subscription/endpoint-address.js';
import { Filter } from '../../src/backend/contexts/notification/domain/subscription/filter.js';
import { Subscription } from '../../src/backend/contexts/notification/domain/subscription/subscription.js';

describe('workflow completion via human response (DDD bootstrap, no Postgres)', () => {
  let booted;
  let received;
  let userId;
  let accessToken;

  beforeAll(async () => {
    booted = await bootstrap({
      JWT_SECRET: 'workflow-completion-test-secret',
      LOG_LEVEL: 'error',
      DATABASE_URL: undefined,
      REDIS_URL: undefined,
    });

    // Seed an admin user; the human-response authorisation path needs a
    // real identity record so the eligibility service can resolve the actor.
    const reg = await booted.ctx.identity.useCases.registerUser.execute({
      email: 'reviewer@example.com',
      username: 'reviewer',
      password: 'Test-Password-123!',
      role: 'admin',
    });
    userId = reg.id;

    // Mint an access token tied to the seeded user so the HTTP layer
    // accepts requests under the same identity.
    const issued = await booted.ctx.identity.tokenIssuer.issueAccess(
      { sub: userId, role: 'admin', sid: 'wf-completion-session' },
      900,
    );
    accessToken = issued.token;

    // Subscribe a WebSocket connection with no filter so we see every
    // envelope routed through the in-memory broadcaster.
    received = [];
    const sub = new Subscription({
      id: 'wf-completion-sub',
      subscriberKind: 'user',
      subscriberRef: userId,
      channel: Channel.of('websocket'),
      address: EndpointAddress.of({ channel: 'websocket', value: userId }),
      filter: Filter.of({}),
      isActive: true,
      createdAt: new Date().toISOString(),
    });
    await booted.ctx.notification.repositories.subscriptionRepository.save(sub);
    booted.ctx.notification.transports.websocketBroadcaster.register(
      'wf-completion-conn',
      async (envelope) => { received.push(envelope); },
      { subscriberRef: userId },
    );
  });

  afterAll(async () => {
    if (booted) await booted.shutdown();
  });

  test('full lifecycle: created -> waiting_for_human -> completed via /respond', async () => {
    // 1. Create a `data-analysis` workflow over the HTTP surface.
    const createRes = await request(booted.app)
      .post('/api/v1/workflows')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', 'wf-completion-create-1')
      .send({ template: 'data-analysis', context: { dataset: 'sales-q4' } });
    expect(createRes.status).toBe(201);
    const workflowId = createRes.body?.data?.workflow_id;
    expect(workflowId).toEqual(expect.any(String));

    // 2. Execute it. The data-analysis template ends in a human-review
    //    step, so this returns with status `waiting_for_human`.
    const execRes = await request(booted.app)
      .post(`/api/v1/workflows/${workflowId}/execute`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', 'wf-completion-exec-1')
      .send({});
    expect(execRes.status).toBe(200);
    expect(execRes.body?.data?.status).toBe('waiting_for_human');

    // 3. Discover the pending step id from the read model.
    const detailRes = await request(booted.app)
      .get(`/api/v1/workflows/${workflowId}`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(detailRes.status).toBe(200);
    const steps = detailRes.body?.data?.workflow?.steps ?? [];
    const pendingStep = steps.find((s) => s.status === 'waiting_for_human');
    expect(pendingStep).toBeDefined();
    const stepId = pendingStep.id;

    // 4. Submit a human response. Prior to the iteration-3 fix this
    //    request would record the response but `AdvanceWorkflow` would
    //    re-run the engine without applying it; the workflow would
    //    remain `waiting_for_human` and never complete.
    const respondRes = await request(booted.app)
      .post(`/api/v1/workflows/${workflowId}/respond`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', 'wf-completion-respond-1')
      .send({
        step_id: stepId,
        action: 'approve',
        payload: { reviewer_note: 'looks good', score: 0.95 },
      });
    expect([200, 201]).toContain(respondRes.status);

    // Give the in-process forwarder a moment to flush any final
    // envelopes (the advancer is awaited inline, but the broadcaster
    // queue is drained via microtasks).
    await flushTicks(20);

    // 5. The workflow must now be terminal.
    const finalRes = await request(booted.app)
      .get(`/api/v1/workflows/${workflowId}`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(finalRes.status).toBe(200);
    expect(finalRes.body?.data?.workflow?.status).toBe('completed');

    // 6. The broadcaster must have observed the FULL canonical event
    //    sequence — most importantly the terminal `workflow.completed`
    //    envelope, which was missing before this fix.
    const types = received.map((e) => e.eventType ?? e.type);
    expect(types).toEqual(expect.arrayContaining([
      'workflow_orchestration.workflow.created',
      'workflow_orchestration.workflow.started',
      'workflow_orchestration.workflow.human_input_required',
      'human_response.recorded',
      'workflow_orchestration.workflow.step_completed',
      'workflow_orchestration.workflow.completed',
    ]));

    // 7. Ordering sanity: `workflow.completed` MUST come after
    //    `human_input_required` (the workflow was parked, then unparked,
    //    then completed — not completed before the human ever responded).
    const humanIdx = types.lastIndexOf('workflow_orchestration.workflow.human_input_required');
    const completedIdx = types.lastIndexOf('workflow_orchestration.workflow.completed');
    expect(humanIdx).toBeGreaterThanOrEqual(0);
    expect(completedIdx).toBeGreaterThan(humanIdx);
  });
});

async function flushTicks(n) {
  for (let i = 0; i < n; i += 1) {
    await new Promise((r) => setImmediate(r));
  }
}
