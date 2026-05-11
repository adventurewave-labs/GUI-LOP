/**
 * WorkflowRepository contract suite.
 *
 * Covers the full aggregate round trip — workflow + ordered steps +
 * transitions — and the optimistic-concurrency invariant (a stale
 * save throws `WorkflowConflictError`). Also asserts `status(id)`
 * returns the narrow read both adapters expose.
 *
 * The in-memory adapter mirrors the Postgres semantics by bumping
 * `version` on save and rejecting stale writes; the Postgres path
 * does the same with a guarded `UPDATE … WHERE id = ? AND version = ?`.
 */

import { describeIfDocker } from '../_helpers/docker-available.js';
import { startPostgres } from '../_fixtures/postgres.js';
import { InMemoryWorkflowRepository } from '../../../src/backend/contexts/workflow-orchestration/infrastructure/persistence/inmemory-workflow-repository.js';
import { PgWorkflowRepository } from '../../../src/backend/contexts/workflow-orchestration/infrastructure/persistence/pg-workflow-repository.js';
import { Workflow } from '../../../src/backend/contexts/workflow-orchestration/domain/workflow/workflow.js';
import { WorkflowTemplate } from '../../../src/backend/contexts/workflow-orchestration/domain/template/workflow-template.js';
import { WorkflowConflictError } from '../../../src/backend/contexts/workflow-orchestration/domain/errors.js';
import { WorkflowStatus } from '../../../src/backend/contexts/workflow-orchestration/domain/workflow/workflow-status.js';

const FIXED_NOW = new Date('2026-05-10T10:00:00.000Z');

function buildTemplate() {
  const t = WorkflowTemplate.draft({
    key: 'invoice-approval',
    version: 1,
    name: 'Invoice Approval',
    now: FIXED_NOW,
  });
  t.addStep({ name: 'collect', kind: 'automated' });
  t.addStep({ name: 'approve', kind: 'human' });
  t.publish({ now: FIXED_NOW, actor: { type: 'system' } });
  t.pullEvents();
  return t;
}

function buildWorkflow({ id = 'wf-1' } = {}) {
  const wf = Workflow.createFromTemplate({
    id,
    template: buildTemplate(),
    context: { invoiceId: 'INV-001', amount: 1200 },
    now: FIXED_NOW,
    actor: { type: 'user', id: 'u-1' },
  });
  wf.pullEvents();
  return wf;
}

describeIfDocker('WorkflowRepository contract', () => {
  let pg;
  const make = {
    'in-memory': () => new InMemoryWorkflowRepository(),
    'postgres': () => null,
  };

  beforeAll(async () => {
    pg = await startPostgres();
    make.postgres = () => new PgWorkflowRepository({ pool: pg.pool, outbox: undefined });
  }, 90_000);

  afterAll(async () => {
    if (pg) await pg.cleanup();
  });

  beforeEach(async () => {
    if (pg) await pg.truncate();
  });

  describe.each([
    ['in-memory'],
    ['postgres'],
  ])('%s adapter', (label) => {
    let repo;

    beforeEach(() => {
      repo = make[label]();
    });

    test('save then findById round-trips the aggregate', async () => {
      const wf = buildWorkflow();
      await repo.save(wf);
      const loaded = await repo.findById('wf-1');
      expect(loaded).not.toBeNull();
      expect(loaded.id).toBe('wf-1');
      expect(loaded.templateKey).toBe('invoice-approval');
      expect(loaded.templateVersion).toBe(1);
      expect(loaded.steps).toHaveLength(2);
      expect(loaded.steps.map((s) => s.name)).toEqual(['collect', 'approve']);
      expect(loaded.steps.map((s) => s.order)).toEqual([0, 1]);
      expect(loaded.status).toBe(WorkflowStatus.CREATED);
      // version bumps from 0 to 1 on the first successful save.
      expect(loaded.version).toBe(1);
    });

    test('save persists transitions and status changes', async () => {
      const wf = buildWorkflow();
      await repo.save(wf);
      const reloaded = await repo.findById('wf-1');
      reloaded.start(FIXED_NOW, { actor: { type: 'system' } });
      await repo.save(reloaded);
      const after = await repo.findById('wf-1');
      expect(after.status).toBe(WorkflowStatus.RUNNING);
      expect(after.transitions.length).toBeGreaterThanOrEqual(1);
      expect(after.transitions[0].to).toBe(WorkflowStatus.RUNNING);
      expect(after.version).toBe(2);
    });

    test('stale save throws WorkflowConflictError', async () => {
      const wf = buildWorkflow();
      await repo.save(wf);              // version 0 -> 1
      const a = await repo.findById('wf-1'); // a.version === 1
      const b = await repo.findById('wf-1'); // b.version === 1
      a.start(FIXED_NOW);
      await repo.save(a);               // commits at version 2
      // b is now stale; touching+saving must throw.
      b.start(FIXED_NOW);
      await expect(repo.save(b)).rejects.toThrow(WorkflowConflictError);
    });

    test('status(id) returns the narrow read shape', async () => {
      const wf = buildWorkflow();
      await repo.save(wf);
      const status = await repo.status('wf-1');
      expect(status).toMatchObject({ status: WorkflowStatus.CREATED });
      expect(status.version).toBeGreaterThanOrEqual(1);
    });

    test('status(id) returns null for unknown workflow', async () => {
      expect(await repo.status('no-such-id')).toBeNull();
    });

    test('findById returns null for unknown workflow', async () => {
      expect(await repo.findById('no-such-id')).toBeNull();
    });
  });
});
