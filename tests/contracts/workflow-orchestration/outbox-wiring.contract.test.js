/**
 * Workflow repositories × the REAL Postgres outbox (roadmap P4).
 *
 * The repository contract suites ran the Pg adapters with `outbox:
 * undefined`, so they never saw that, in production wiring:
 *   - PgWorkflowRepository passed the bare client where the outbox expects a
 *     unit-of-work `{ client }` → every workflow create/execute/cancel 500'd;
 *   - PgWorkflowTemplateRepository enqueued outside any transaction →
 *     every template publish/deprecate 500'd;
 *   - template aggregate ids ("key@version") and free-form correlation ids
 *     hit uuid columns (22P02) — fixed by migration 016.
 * Also pins the transactional-outbox guarantee: when the aggregate write
 * rolls back, its events are not left behind.
 */
import { randomUUID } from 'node:crypto';
import { describeIfDocker } from '../_helpers/docker-available.js';
import { startPostgres } from '../_fixtures/postgres.js';
import { createPgOutboxRepository } from '../../../src/backend/shared-kernel/infrastructure/pg-outbox-repository.js';
import { PgWorkflowRepository } from '../../../src/backend/contexts/workflow-orchestration/infrastructure/persistence/pg-workflow-repository.js';
import { PgWorkflowTemplateRepository } from '../../../src/backend/contexts/workflow-orchestration/infrastructure/persistence/pg-workflow-template-repository.js';
import { Workflow } from '../../../src/backend/contexts/workflow-orchestration/domain/workflow/workflow.js';
import { WorkflowTemplate } from '../../../src/backend/contexts/workflow-orchestration/domain/template/workflow-template.js';
import { WorkflowConflictError, TemplateVersionExistsError } from '../../../src/backend/contexts/workflow-orchestration/domain/errors.js';

const NOW = new Date('2026-10-01T12:00:00.000Z');

describeIfDocker('workflow repositories × Postgres outbox', () => {
  let pg; let outbox; let workflows; let templates;

  beforeAll(async () => {
    pg = await startPostgres({ applyAnalytics: false });
    outbox = createPgOutboxRepository(pg.pool);
    workflows = new PgWorkflowRepository({ pool: pg.pool, outbox });
    templates = new PgWorkflowTemplateRepository({ pool: pg.pool, outbox, logger: { warn() {} } });
  }, 90_000);
  afterAll(async () => { if (pg) await pg.cleanup(); });
  beforeEach(async () => { await pg.truncate(); });

  const rows = async (aggregateId) => (await pg.pool.query(
    'SELECT event_type, aggregate_id, correlation_id, status FROM outbox WHERE aggregate_id = $1 ORDER BY occurred_at, event_type',
    [aggregateId],
  )).rows;

  const publishedTemplate = async (key = 'invoice-approval') => {
    const t = WorkflowTemplate.draft({ key, version: 1, name: 'Invoice Approval', now: NOW });
    t.addStep({ name: 'collect', kind: 'automated' });
    t.addStep({ name: 'approve', kind: 'human' });
    t.publish({ now: NOW, actor: { type: 'system' } });
    await templates.save(t);
    return t;
  };

  test('template publish persists the row and its event ("key@version" aggregate id) in one transaction', async () => {
    await publishedTemplate();
    expect(await templates.findCurrent('invoice-approval')).toBeTruthy();
    const ev = await rows('invoice-approval@1');
    expect(ev.length).toBeGreaterThanOrEqual(1);
    expect(ev.every((r) => r.status === 'pending')).toBe(true);
  });

  test('workflow create persists the workflow and its events, with a non-UUID correlation id', async () => {
    const template = await publishedTemplate();
    const id = randomUUID();
    const wf = Workflow.createFromTemplate({
      stepIdGen: { next: () => randomUUID() },
      id,
      template,
      context: { invoiceId: 'INV-1' },
      now: NOW,
      actor: { type: 'user', id: randomUUID() },
      correlationId: 'req-01J9ZQ-not-a-uuid',
    });
    await workflows.save(wf);
    expect((await workflows.findById(id))?.id).toBe(id);
    const ev = await rows(id);
    expect(ev.map((r) => r.event_type)).toEqual(expect.arrayContaining([expect.stringMatching(/workflow\./)]));
  });

  test('a rolled-back aggregate write leaves no events behind (transactional outbox)', async () => {
    const template = await publishedTemplate();
    const id = randomUUID();
    const make = () => Workflow.createFromTemplate({
      stepIdGen: { next: () => randomUUID() }, id, template, context: {}, now: NOW, actor: { type: 'user', id: randomUUID() },
    });
    const first = make();
    await workflows.save(first);
    const before = (await rows(id)).length;

    const stale = await workflows.findById(id);
    const winner = await workflows.findById(id);
    winner.start(NOW, { actor: { type: 'user', id: randomUUID() } });
    await workflows.save(winner);
    const afterWinner = (await rows(id)).length;
    expect(afterWinner).toBeGreaterThan(before);

    stale.start(NOW, { actor: { type: 'user', id: randomUUID() } }); // same change, stale version
    await expect(workflows.save(stale)).rejects.toBeInstanceOf(WorkflowConflictError);
    expect((await rows(id)).length).toBe(afterWinner); // the loser's events were rolled back
  });

  test('createOnly publish: 8 concurrent writers of one (key, version) — exactly one wins, no events from the losers', async () => {
    const make = (name) => {
      const t = WorkflowTemplate.draft({ key: 'race-flow', version: 1, name, now: NOW });
      t.addStep({ name: 'a', kind: 'automated' });
      t.publish({ now: NOW, actor: { type: 'system' } });
      return t;
    };
    const results = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => templates.save(make(`writer-${i}`), { createOnly: true })));
    const won = results.filter((r) => r.status === 'fulfilled');
    const lost = results.filter((r) => r.status === 'rejected');
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(7);
    for (const r of lost) expect(r.reason).toBeInstanceOf(TemplateVersionExistsError);
    const { rows: stored } = await pg.pool.query("SELECT name FROM workflow_templates WHERE template_key = 'race-flow'");
    expect(stored).toHaveLength(1);
    expect((await rows('race-flow@1')).length).toBe(1); // only the winner's published event
  });

  test('enqueue refuses to run outside a transaction', async () => {
    await expect(outbox.enqueue([], undefined)).rejects.toThrow(/transaction client/);
    await expect(outbox.enqueue([], {})).rejects.toThrow(/transaction client/);
    // The pool also has .query, so a shape check alone would let it through;
    // enqueueing on it commits events even when the aggregate rolls back.
    await expect(outbox.enqueue([], pg.pool)).rejects.toThrow(/transaction client/);
    await expect(outbox.enqueue([], { client: pg.pool })).rejects.toThrow(/pool/);
  });
});
