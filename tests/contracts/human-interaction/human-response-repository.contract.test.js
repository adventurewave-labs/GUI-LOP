/**
 * HumanResponseRepository contract suite.
 *
 * Asserts:
 *   - `save` + `findById` round-trips a recorded response.
 *   - `findByIdempotencyKey` returns the same row for a duplicate
 *     key (dedupe semantics — the use case relies on this).
 *   - Multiple responses on the same (workflowId, stepId) can be
 *     persisted independently as long as their idempotency keys
 *     differ; `findFor` returns the *first* one.
 *
 * The Postgres adapter writes into the legacy `human_responses` table
 * (see migration 001). Foreign keys on `workflow_id` / `step_id` /
 * `user_id` are NOT enforced at this level because the rows we'd
 * need to seed pre-exist the test focus; the FKs allow NULL on the
 * relevant columns OR cascade DELETE which lets us insert with
 * non-existent ids. We deliberately use UUIDs the test owns and
 * verify the round-trip without seeding parent rows.
 *
 * NOTE: human_responses has FK constraints on workflow_id (NOT NULL
 * via ON DELETE CASCADE column) and step_id. The columns themselves
 * are nullable. To round-trip cleanly we either (a) seed parent
 * rows, or (b) set workflow_id/step_id to NULL — but the in-memory
 * adapter stores them as string keys. We seed minimal parents.
 */

import { describeIfDocker } from '../_helpers/docker-available.js';
import { startPostgres } from '../_fixtures/postgres.js';
import { InMemoryHumanResponseRepository } from '../../../src/backend/contexts/human-interaction/infrastructure/persistence/inmemory-human-response-repository.js';
import { PgHumanResponseRepository } from '../../../src/backend/contexts/human-interaction/infrastructure/persistence/pg-human-response-repository.js';
import { HumanResponse } from '../../../src/backend/contexts/human-interaction/domain/human-response/human-response.js';
import { ResponseValidationService } from '../../../src/backend/contexts/human-interaction/domain/services/response-validation-service.js';

const FIXED_NOW = new Date('2026-05-10T10:00:00.000Z');

const validator = ResponseValidationService.forStep({
  allowedActions: ['approve', 'reject'],
  responseSchema: {
    type: 'object',
    required: ['comment'],
    properties: { comment: { type: 'string' } },
    additionalProperties: false,
  },
});

// Stable UUIDs used by the contract tests. We seed these in Postgres
// before each test so the human_responses FKs are satisfied.
const WORKFLOW_A = '11111111-1111-1111-1111-111111111111';
const STEP_A = '22222222-2222-2222-2222-222222222222';
const STEP_B = '22222222-2222-2222-2222-22222222222b';
const USER_A = '33333333-3333-3333-3333-333333333333';

async function seedParents(pool) {
  await pool.query(
    `INSERT INTO users (id, email, username, password_hash, role)
       VALUES ($1, 'u@example.com', 'uA', 'hash', 'user')
       ON CONFLICT (id) DO NOTHING`,
    [USER_A],
  );
  await pool.query(
    `INSERT INTO workflows (id, template_key, status)
       VALUES ($1, 'invoice-approval', 'waiting_for_human')
       ON CONFLICT (id) DO NOTHING`,
    [WORKFLOW_A],
  );
  await pool.query(
    `INSERT INTO workflow_steps (id, workflow_id, step_name, step_order, status)
       VALUES ($1, $2, 'approve', 0, 'waiting_for_human')
       ON CONFLICT (id) DO NOTHING`,
    [STEP_A, WORKFLOW_A],
  );
  await pool.query(
    `INSERT INTO workflow_steps (id, workflow_id, step_name, step_order, status)
       VALUES ($1, $2, 'review', 1, 'waiting_for_human')
       ON CONFLICT (id) DO NOTHING`,
    [STEP_B, WORKFLOW_A],
  );
}

function buildResponse({ id = 'resp-1', stepId = STEP_A, idempotencyKey = 'key-1' } = {}) {
  return HumanResponse.record({
    id,
    workflowId: WORKFLOW_A,
    stepId,
    responder: USER_A,
    action: 'approve',
    payload: { comment: 'lgtm' },
    idempotencyKey,
    now: FIXED_NOW,
    validator,
  });
}

describeIfDocker('HumanResponseRepository contract', () => {
  let pg;
  const make = {
    'in-memory': () => new InMemoryHumanResponseRepository(),
    'postgres': () => null,
  };

  beforeAll(async () => {
    pg = await startPostgres();
    make.postgres = () => new PgHumanResponseRepository(pg.pool);
  }, 90_000);

  afterAll(async () => {
    if (pg) await pg.cleanup();
  });

  beforeEach(async () => {
    if (pg) {
      await pg.truncate();
      await seedParents(pg.pool);
    }
  });

  describe.each([
    ['in-memory'],
    ['postgres'],
  ])('%s adapter', (label) => {
    let repo;

    beforeEach(() => {
      repo = make[label]();
    });

    test('save then findById round-trips', async () => {
      const r = buildResponse();
      await repo.save(r);
      const found = await repo.findById('resp-1');
      expect(found).not.toBeNull();
      expect(found.id).toBe('resp-1');
      expect(found.action.value).toBe('approve');
      expect(found.payload.toJSON()).toEqual({ comment: 'lgtm' });
      expect(found.idempotencyKey).toBe('key-1');
      expect(found.recordedAt).toEqual(FIXED_NOW);
    });

    test('findByIdempotencyKey returns the original row (dedupe)', async () => {
      const r1 = buildResponse({ id: 'resp-1', idempotencyKey: 'idem-A' });
      await repo.save(r1);
      const found = await repo.findByIdempotencyKey(WORKFLOW_A, STEP_A, 'idem-A');
      expect(found).not.toBeNull();
      expect(found.id).toBe('resp-1');
      // A different key returns null.
      expect(await repo.findByIdempotencyKey(WORKFLOW_A, STEP_A, 'idem-B')).toBeNull();
    });

    test('multiple responses on the same workflow but different steps coexist', async () => {
      await repo.save(buildResponse({ id: 'resp-a', stepId: STEP_A, idempotencyKey: 'a' }));
      await repo.save(buildResponse({ id: 'resp-b', stepId: STEP_B, idempotencyKey: 'b' }));
      const a = await repo.findFor(WORKFLOW_A, STEP_A);
      const b = await repo.findFor(WORKFLOW_A, STEP_B);
      expect(a.id).toBe('resp-a');
      expect(b.id).toBe('resp-b');
    });

    test('findById returns null for missing id', async () => {
      expect(await repo.findById('does-not-exist')).toBeNull();
    });
  });
});
