/**
 * ids.test.js — malformed ids never reach Postgres uuid columns.
 */
import { isUuid } from '../ids.js';
import { PgWorkflowRepository } from '../../../contexts/workflow-orchestration/infrastructure/persistence/pg-workflow-repository.js';
import { PgUIDocumentRepository } from '../../../contexts/ui-generation/infrastructure/persistence/pg-ui-document-repository.js';

describe('isUuid', () => {
  test.each([
    ['3f2b8c1e-9d4a-4e7b-8c2d-1a2b3c4d5e6f', true],
    ['3F2B8C1E-9D4A-4E7B-8C2D-1A2B3C4D5E6F', true],
    ['wf-1', false],
    ['3f2b8c1e9d4a4e7b8c2d1a2b3c4d5e6f', false],
    ["'; DROP TABLE x; --", false],
    [undefined, false],
    [42, false],
  ])('%p → %p', (v, want) => {
    expect(isUuid(v)).toBe(want);
  });
});

describe('Pg repositories short-circuit malformed ids (no 22P02 → 500)', () => {
  const explodingPool = {
    query: async () => { throw Object.assign(new Error('invalid input syntax for type uuid'), { code: '22P02' }); },
    connect: async () => { throw new Error('should not connect'); },
  };

  test('workflow findById/status → null without querying', async () => {
    const repo = new PgWorkflowRepository({ pool: explodingPool });
    await expect(repo.findById('no-such-id')).resolves.toBeNull();
    await expect(repo.status('no-such-id')).resolves.toBeNull();
  });

  test('ui document findById → null without querying', async () => {
    const repo = new PgUIDocumentRepository(explodingPool);
    await expect(repo.findById('ui-1')).resolves.toBeNull();
  });
});
