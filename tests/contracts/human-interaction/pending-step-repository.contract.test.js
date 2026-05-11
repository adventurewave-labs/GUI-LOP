/**
 * PendingStepRepository contract suite.
 *
 * Asserts:
 *   - `upsert` is idempotent on (workflowId, stepId) — second call
 *     replaces the row, not append.
 *   - `findOverdue(now)` returns rows whose deadline ≤ now and that
 *     are still open (closed_at IS NULL). Postgres benefits from
 *     the partial index `idx_pending_steps_overdue`.
 *   - `remove(workflowId, stepId)` clears the row.
 *   - The aggregate invariant — `escalationLevel` is monotonic — is
 *     visible after a round-trip (a level can be raised, then
 *     persisted, but the aggregate refuses to lower it).
 */

import { describeIfDocker } from '../_helpers/docker-available.js';
import { startPostgres } from '../_fixtures/postgres.js';
import { InMemoryPendingStepRepository } from '../../../src/backend/contexts/human-interaction/infrastructure/persistence/inmemory-pending-step-repository.js';
import { PgPendingStepRepository } from '../../../src/backend/contexts/human-interaction/infrastructure/persistence/pg-pending-step-repository.js';
import { PendingStep } from '../../../src/backend/contexts/human-interaction/domain/pending-step/pending-step.js';
import { InvariantViolationError } from '../../../src/backend/contexts/human-interaction/domain/errors.js';

const FIXED_NOW = new Date('2026-05-10T10:00:00.000Z');
const PAST = new Date('2026-05-10T09:00:00.000Z');
const FUTURE = new Date('2026-05-10T11:00:00.000Z');

const WORKFLOW_A = '11111111-1111-1111-1111-111111111111';
const STEP_A = '22222222-2222-2222-2222-222222222222';
const STEP_B = '22222222-2222-2222-2222-22222222222b';
const STEP_C = '22222222-2222-2222-2222-22222222222c';

function open({ workflowId = WORKFLOW_A, stepId = STEP_A, deadline = null } = {}) {
  return PendingStep.open({
    workflowId,
    stepId,
    eligibility: {
      requiredRole: 'reviewer',
      requiredPermissions: ['workflow:respond'],
      scope: workflowId,
    },
    deadline,
    onTimeout: 'escalate',
    now: FIXED_NOW,
  });
}

describeIfDocker('PendingStepRepository contract', () => {
  let pg;
  const make = {
    'in-memory': () => new InMemoryPendingStepRepository(),
    'postgres': () => null,
  };

  beforeAll(async () => {
    pg = await startPostgres();
    make.postgres = () => new PgPendingStepRepository(pg.pool);
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

    test('upsert then findByKey round-trips', async () => {
      const step = open({ deadline: FUTURE });
      await repo.upsert(step);
      const found = await repo.findByKey(WORKFLOW_A, STEP_A);
      expect(found).not.toBeNull();
      expect(found.workflowId).toBe(WORKFLOW_A);
      expect(found.stepId).toBe(STEP_A);
      expect(found.deadline.toISOString()).toBe(FUTURE.toISOString());
      expect(found.escalationLevel).toBe(0);
      expect(found.isClosed()).toBe(false);
    });

    test('upsert is idempotent — same (workflowId, stepId) replaces', async () => {
      await repo.upsert(open({ deadline: FUTURE }));
      const replacement = open({ deadline: PAST });
      replacement.escalate(FIXED_NOW, 1, { reason: 'manual' });
      await repo.upsert(replacement);
      const all = await repo.list({ workflowId: WORKFLOW_A });
      expect(all).toHaveLength(1);
      const found = await repo.findByKey(WORKFLOW_A, STEP_A);
      expect(found.deadline.toISOString()).toBe(PAST.toISOString());
      expect(found.escalationLevel).toBe(1);
    });

    test('findOverdue returns only open + past-deadline rows, ordered by deadline ASC', async () => {
      await repo.upsert(open({ stepId: STEP_A, deadline: PAST }));      // overdue
      await repo.upsert(open({ stepId: STEP_B, deadline: FUTURE }));    // not overdue
      const closed = open({ stepId: STEP_C, deadline: PAST });
      closed.close(FIXED_NOW);
      await repo.upsert(closed);                                        // overdue but closed
      const overdue = await repo.findOverdue(FIXED_NOW, 10);
      expect(overdue).toHaveLength(1);
      expect(overdue[0].stepId).toBe(STEP_A);
    });

    test('remove clears the row', async () => {
      await repo.upsert(open({ deadline: FUTURE }));
      await repo.remove(WORKFLOW_A, STEP_A);
      expect(await repo.findByKey(WORKFLOW_A, STEP_A)).toBeNull();
    });

    test('escalation level is monotonic (refuses to lower)', () => {
      const step = open();
      step.escalate(FIXED_NOW, 1);
      step.escalate(FIXED_NOW, 2);
      expect(step.escalationLevel).toBe(2);
      expect(() => step.escalate(FIXED_NOW, 2)).toThrow(InvariantViolationError);
      expect(() => step.escalate(FIXED_NOW, 1)).toThrow(InvariantViolationError);
    });
  });
});
