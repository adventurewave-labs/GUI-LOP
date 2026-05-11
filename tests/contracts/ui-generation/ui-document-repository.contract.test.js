/**
 * UIDocumentRepository contract suite.
 *
 * Asserts:
 *   - `save` + `findById` round-trips a generated UIDocument.
 *   - `findByStep(workflowId, stepId)` returns ALL documents for
 *     that step (the production code lets versions accumulate;
 *     Postgres orders newest-first).
 *   - The aggregate is immutable (Object.frozen) so mutation
 *     attempts throw in strict mode. We assert this once because
 *     it's an aggregate-level invariant common to both adapters.
 */

import { describeIfDocker } from '../_helpers/docker-available.js';
import { startPostgres } from '../_fixtures/postgres.js';
import { InMemoryUIDocumentRepository } from '../../../src/backend/contexts/ui-generation/infrastructure/persistence/inmemory-ui-document-repository.js';
import { PgUIDocumentRepository } from '../../../src/backend/contexts/ui-generation/infrastructure/persistence/pg-ui-document-repository.js';
import { UIDocument } from '../../../src/backend/contexts/ui-generation/domain/ui-document.js';

const WORKFLOW = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const STEP = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

function doc({ id, version = 1, url = 'https://app/ui/1', when }) {
  return new UIDocument({
    id,
    workflowId: WORKFLOW,
    stepId: STEP,
    url,
    contentRef: `s3://bucket/${id}`,
    strategy: 'stub',
    version,
    generatedAt: when ?? '2026-05-10T10:00:00.000Z',
  });
}

describeIfDocker('UIDocumentRepository contract', () => {
  let pg;
  const make = {
    'in-memory': () => new InMemoryUIDocumentRepository(),
    'postgres': () => null,
  };

  beforeAll(async () => {
    pg = await startPostgres();
    make.postgres = () => new PgUIDocumentRepository(pg.pool);
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
    beforeEach(() => { repo = make[label](); });

    test('save then findById round-trips a UIDocument', async () => {
      const d = doc({ id: 'ui-1', version: 1 });
      await repo.save(d);
      const found = await repo.findById('ui-1');
      expect(found).not.toBeNull();
      expect(found.workflowId).toBe(WORKFLOW);
      expect(found.stepId).toBe(STEP);
      expect(found.url).toBe('https://app/ui/1');
      expect(found.contentRef).toBe('s3://bucket/ui-1');
      expect(found.strategy).toBe('stub');
      expect(found.version).toBe(1);
    });

    test('findByStep returns docs for that (workflowId, stepId)', async () => {
      const d1 = doc({ id: 'ui-1', version: 1, when: '2026-05-10T10:00:00.000Z' });
      const d2 = doc({ id: 'ui-2', version: 2, when: '2026-05-10T11:00:00.000Z' });
      const dOther = new UIDocument({
        id: 'ui-3',
        workflowId: WORKFLOW,
        stepId: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
        url: 'https://app/ui/3',
        contentRef: 's3://bucket/ui-3',
        strategy: 'stub',
        version: 1,
        generatedAt: '2026-05-10T12:00:00.000Z',
      });
      await repo.save(d1);
      await repo.save(d2);
      await repo.save(dOther);
      const list = await repo.findByStep(WORKFLOW, STEP);
      const ids = list.map((x) => x.id).sort();
      expect(ids).toEqual(['ui-1', 'ui-2']);
    });

    test('UIDocument aggregate is immutable (frozen)', () => {
      const d = doc({ id: 'ui-frozen' });
      expect(Object.isFrozen(d)).toBe(true);
      // Direct mutation must throw in strict mode (Jest runs strict).
      expect(() => { d.url = 'tampered'; }).toThrow(TypeError);
    });
  });
});
