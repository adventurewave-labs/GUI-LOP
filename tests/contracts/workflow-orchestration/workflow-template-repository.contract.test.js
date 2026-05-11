/**
 * WorkflowTemplateRepository contract suite.
 *
 * Asserts the same behaviour against the in-memory and the
 * Postgres-backed adapters: `findCurrent` returns the latest
 * published version; `findVersion` returns by exact (key, version);
 * `save` persists state; `list({ activeOnly })` filters out
 * deprecated templates; and a *published* template cannot be
 * mutated through subsequent `addStep` calls.
 *
 * Also exercises migration 010 — the Postgres path must read the
 * real `version` column, not the legacy `default_config.__version`
 * back-channel.
 */

import { describeIfDocker } from '../_helpers/docker-available.js';
import { startPostgres } from '../_fixtures/postgres.js';
import { InMemoryWorkflowTemplateRepository } from '../../../src/backend/contexts/workflow-orchestration/infrastructure/persistence/inmemory-workflow-template-repository.js';
import { PgWorkflowTemplateRepository } from '../../../src/backend/contexts/workflow-orchestration/infrastructure/persistence/pg-workflow-template-repository.js';
import { WorkflowTemplate } from '../../../src/backend/contexts/workflow-orchestration/domain/template/workflow-template.js';
import { TemplateImmutableError } from '../../../src/backend/contexts/workflow-orchestration/domain/errors.js';

const FIXED_NOW = new Date('2026-05-10T10:00:00.000Z');

function makeDraft({ key = 'invoice-approval', version = 1, name = 'Invoice Approval' } = {}) {
  const t = WorkflowTemplate.draft({ key, version, name, now: FIXED_NOW });
  t.addStep({ name: 'collect', kind: 'automated' });
  t.addStep({ name: 'approve', kind: 'human' });
  return t;
}

function publish(t) {
  t.publish({ now: FIXED_NOW, actor: { type: 'system' } });
  t.pullEvents();
  return t;
}

describeIfDocker('WorkflowTemplateRepository contract', () => {
  let pg;
  const make = {
    'in-memory': () => new InMemoryWorkflowTemplateRepository(),
    'postgres': () => null, // set after pg is up
  };

  beforeAll(async () => {
    pg = await startPostgres();
    make.postgres = () => new PgWorkflowTemplateRepository({
      pool: pg.pool,
      outbox: undefined,
      logger: { warn: () => {} },
    });
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

    test('save then findCurrent returns the same draft', async () => {
      const t = makeDraft();
      await repo.save(t);
      const found = await repo.findCurrent('invoice-approval');
      expect(found).not.toBeNull();
      expect(found.key.value).toBe('invoice-approval');
      expect(found.version.value).toBe(1);
      expect(found.steps).toHaveLength(2);
      expect(found.steps[0].name).toBe('collect');
      expect(found.steps[1].name).toBe('approve');
    });

    test('findCurrent on unknown key returns null', async () => {
      expect(await repo.findCurrent('does-not-exist')).toBeNull();
    });

    test('findVersion returns the exact (key, version) pair', async () => {
      const v1 = publish(makeDraft({ version: 1 }));
      const v2 = publish(makeDraft({ version: 2 }));
      await repo.save(v1);
      await repo.save(v2);
      const r1 = await repo.findVersion('invoice-approval', 1);
      const r2 = await repo.findVersion('invoice-approval', 2);
      expect(r1).not.toBeNull();
      expect(r2).not.toBeNull();
      expect(r1.version.value).toBe(1);
      expect(r2.version.value).toBe(2);
    });

    test('findCurrent prefers a published version over a draft', async () => {
      const draft = makeDraft({ version: 2 });
      const published = publish(makeDraft({ version: 1 }));
      await repo.save(draft);
      await repo.save(published);
      const current = await repo.findCurrent('invoice-approval');
      expect(current).not.toBeNull();
      expect(current.isPublished()).toBe(true);
    });

    test('list({ activeOnly: true }) excludes deprecated templates', async () => {
      const a = publish(makeDraft({ key: 'a', version: 1, name: 'A' }));
      const b = publish(makeDraft({ key: 'b', version: 1, name: 'B' }));
      b.deprecate({ now: FIXED_NOW, actor: { type: 'system' } });
      b.pullEvents();
      await repo.save(a);
      await repo.save(b);
      const all = await repo.list();
      const active = await repo.list({ activeOnly: true });
      expect(all.length).toBeGreaterThanOrEqual(2);
      expect(active.map((t) => t.key.value).sort()).toEqual(['a']);
    });

    test('published template rejects further addStep mutations', () => {
      const t = publish(makeDraft());
      expect(() => t.addStep({ name: 'audit', kind: 'automated' })).toThrow(
        TemplateImmutableError,
      );
    });
  });

  test('postgres reads version from the real column (migration 010)', async () => {
    const t = publish(makeDraft({ version: 3 }));
    const repo = make.postgres();
    await repo.save(t);
    const { rows } = await pg.pool.query(
      `SELECT version, default_config FROM workflow_templates
        WHERE template_key = $1`,
      ['invoice-approval'],
    );
    expect(rows[0].version).toBe(3);
    const cfg = rows[0].default_config ?? {};
    expect(cfg.__version).toBeUndefined();
    expect(cfg.__status).toBeUndefined();
  });
});
