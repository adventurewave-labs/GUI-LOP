/**
 * domain-purity.bench.js — pure domain hot-path microbenchmarks.
 *
 *   - workflow.next_action            Decide next action on a 5-step workflow.
 *   - workflow.apply_human_response   Resume a paused workflow via the
 *                                      human-input completion path.
 *   - response_validation.validate    Validate (action, payload) against a
 *                                      representative JSON-schema-ish spec.
 *   - authorisation.is_authorised     Run the role+grant policy with a
 *                                      realistic permission set.
 *
 * Pure functions, zero I/O — these set the floor for everything above.
 */

import { fileURLToPath } from 'node:url';

import { uuidGenerator } from '../../../src/backend/shared-kernel/infrastructure/uuid-generator.js';

import { Workflow } from '../../../src/backend/contexts/workflow-orchestration/domain/workflow/workflow.js';
import { WorkflowTemplate } from '../../../src/backend/contexts/workflow-orchestration/domain/template/workflow-template.js';

import { ResponseValidationService } from '../../../src/backend/contexts/human-interaction/domain/services/response-validation-service.js';

import { isAuthorised } from '../../../src/backend/contexts/identity-and-access/domain/permission/authorisation-policy.js';
import { Permission } from '../../../src/backend/contexts/identity-and-access/domain/permission/permission.js';

import { runStandalone } from '../runner.js';

/* ---------------- fixtures ---------------- */

function buildPausableTemplate() {
  const now = new Date();
  const tpl = WorkflowTemplate.draft({
    key: 'bench-domain',
    version: 1,
    name: 'Domain Bench',
    description: 'Five-step template with a human pause for next_action benches',
    defaultConfig: {},
    now,
  });
  tpl.addStep({ name: 'Ingest', kind: 'automated' }, now);
  tpl.addStep({ name: 'Analyse', kind: 'automated' }, now);
  tpl.addStep({ name: 'Synthesise', kind: 'automated' }, now);
  tpl.addStep({ name: 'Review', kind: 'human' }, now);
  tpl.addStep({ name: 'Finalise', kind: 'automated' }, now);
  tpl.publish({ now });
  return tpl;
}

function buildRunningWorkflow(template) {
  const wf = Workflow.createFromTemplate({
    id: uuidGenerator.next(),
    template,
    context: { tiny: true },
    createdBy: 'bench-user',
    now: new Date(),
    stepIdGen: { next: () => uuidGenerator.next() },
    actor: { id: 'bench-user', type: 'user' },
  });
  wf.start(new Date(), { actor: { id: 'bench-user' } });
  // Run the first 3 automated steps so the workflow is mid-flight when
  // next_action is queried.
  for (let i = 0; i < 3; i += 1) {
    const step = wf.steps[i];
    wf.beginStep(step.id, new Date(), { actor: { id: 'bench-user' } });
    wf.recordStepOutput(step.id, { ok: true, i }, new Date(), { actor: { id: 'bench-user' } });
  }
  return wf;
}

const REPRESENTATIVE_SCHEMA = Object.freeze({
  type: 'object',
  required: ['decision', 'rationale'],
  properties: {
    decision: { type: 'string', enum: ['approve', 'reject', 'request_changes'] },
    rationale: { type: 'string' },
    confidence: { type: 'number', minimum: 0 },
    tags: { type: 'string' },
  },
  additionalProperties: false,
});

function buildAuthFixtures() {
  // Realistic role mix: 8 permissions on the role, plus 4 direct grants.
  const rolePerms = [
    new Permission('workflow:read'),
    new Permission('workflow:create'),
    new Permission('workflow:respond'),
    new Permission('template:read'),
    new Permission('inbox:read'),
    new Permission('notification:read'),
    new Permission('subscription:create'),
    new Permission('audit:read'),
  ];
  const grants = [
    Permission.of('workflow', 'execute', 'wf-1'),
    Permission.of('workflow', 'cancel', 'wf-1'),
    Permission.of('template', 'publish'),
    Permission.of('template', 'deprecate'),
  ];
  const allPerms = [...rolePerms, ...grants];
  const user = {
    id: 'bench-user',
    role: { value: 'user' },
    isActive: true,
  };
  const requiredGranted = new Permission('workflow:read');
  const requiredScoped = Permission.of('workflow', 'execute', 'wf-1');
  return { user, allPerms, requiredGranted, requiredScoped };
}

/* ---------------- bench builder ---------------- */

export function buildDomainBenches() {
  let template = null;
  let runningWf = null;
  let validator = null;
  let authFixtures = null;

  return [
    {
      name: 'workflow.next_action',
      warmup: 100,
      iterations: 1000,
      async setup() {
        template = buildPausableTemplate();
        runningWf = buildRunningWorkflow(template);
      },
      fn() {
        runningWf.nextAction();
      },
    },

    {
      name: 'workflow.apply_human_response',
      // Each iteration mutates state so we must reset per call. We measure
      // the cost of the apply + advance; setup builds N pre-paused workflows.
      warmup: 50,
      iterations: 500,
      async setup() {
        if (!template) template = buildPausableTemplate();
        const pool = [];
        for (let i = 0; i < 50 + 500; i += 1) {
          // Build a workflow paused on step index 3 ("Review", human).
          const wf = Workflow.createFromTemplate({
            id: uuidGenerator.next(),
            template,
            context: {},
            createdBy: 'bench-user',
            now: new Date(),
            stepIdGen: { next: () => uuidGenerator.next() },
            actor: { id: 'bench-user' },
          });
          wf.start(new Date(), { actor: { id: 'bench-user' } });
          // Run automated 0..2.
          for (let j = 0; j < 3; j += 1) {
            const s = wf.steps[j];
            wf.beginStep(s.id, new Date(), { actor: { id: 'bench-user' } });
            wf.recordStepOutput(s.id, { ok: true }, new Date(), { actor: { id: 'bench-user' } });
          }
          // Pause on step 3.
          const human = wf.steps[3];
          wf.markStepWaitingForHuman(human.id, { form: 'review' }, new Date(), {
            actor: { id: 'bench-user' },
          });
          pool.push({ wf, stepId: human.id });
        }
        return { pool, cursor: 0 };
      },
      fn(state) {
        const item = state.pool[state.cursor++];
        if (!item) throw new Error('out of pre-paused workflows');
        item.wf.applyHumanResponse(
          item.stepId,
          { ok: true, decision: 'approve' },
          new Date(),
          { actor: { id: 'bench-user' } },
        );
      },
    },

    {
      name: 'response_validation.validate',
      warmup: 100,
      iterations: 1000,
      setup() {
        validator = new ResponseValidationService({
          allowedActions: ['approve', 'reject', 'request_changes'],
          payloadSchema: REPRESENTATIVE_SCHEMA,
        });
      },
      fn() {
        const r = validator.validate('approve', {
          decision: 'approve',
          rationale: 'Looks good to me',
          confidence: 0.9,
          tags: 'reviewed',
        });
        // Touch the result so V8 doesn't elide the work.
        if (r.isErr && r.isErr()) throw new Error('unexpected validation failure');
      },
    },

    {
      name: 'authorisation.is_authorised',
      warmup: 100,
      iterations: 1000,
      setup() {
        authFixtures = buildAuthFixtures();
      },
      fn(_state, i) {
        const { user, allPerms, requiredGranted, requiredScoped } = authFixtures;
        // Alternate between an unscoped check and a scoped check so we
        // cover both branches of the policy.
        const required = i % 2 === 0 ? requiredGranted : requiredScoped;
        const r = isAuthorised(user, allPerms, required, i % 2 === 0 ? null : 'wf-1');
        if (!r.isOk()) throw new Error('expected ok');
      },
    },
  ];
}

/* ---------------- standalone entry ---------------- */

async function main() {
  await runStandalone('domain-purity', () => buildDomainBenches());
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('domain-purity bench failed:', err);
    process.exit(1);
  });
}

