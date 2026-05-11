/**
 * DeadLetterRepository contract suite.
 *
 * Asserts:
 *   - `save(record)` + `findById` round-trips the envelope (a JSONB
 *     blob) without lossy serialisation.
 *   - `list({ limit, offset })` returns rows ordered newest-first
 *     (created_at DESC) and respects pagination bounds.
 *   - `delete(id)` removes the row.
 *
 * The `dead_letters` table is created twice in the migration set —
 * once minimally in `003_outbox_and_idempotency.sql`, then in a
 * richer notification-context shape in `006_subscriptions.sql`. The
 * `006` definition wins on a fresh DB because `CREATE TABLE IF NOT
 * EXISTS` is a no-op when the prior already exists; we therefore
 * test against whatever the migrations produce.
 */

import { describeIfDocker } from '../_helpers/docker-available.js';
import { startPostgres } from '../_fixtures/postgres.js';
import { InMemoryDeadLetterRepository } from '../../../src/backend/contexts/notification/infrastructure/persistence/inmemory-dead-letter-repository.js';
import { PgDeadLetterRepository } from '../../../src/backend/contexts/notification/infrastructure/persistence/pg-dead-letter-repository.js';

const DL_1 = 'cccccccc-cccc-cccc-cccc-ccccccccccc1';
const DL_2 = 'cccccccc-cccc-cccc-cccc-ccccccccccc2';
const DL_3 = 'cccccccc-cccc-cccc-cccc-ccccccccccc3';

function record({ id, when, env = {} } = {}) {
  return {
    id,
    subscriptionId: null,
    eventId: null,
    envelope: { kind: 'workflow.event', ...env },
    attempts: 3,
    error: 'all retries exhausted',
    createdAt: when,
  };
}

describeIfDocker('DeadLetterRepository contract', () => {
  let pg;
  const make = {
    'in-memory': () => new InMemoryDeadLetterRepository(),
    'postgres': () => null,
  };

  beforeAll(async () => {
    pg = await startPostgres();
    make.postgres = () => new PgDeadLetterRepository(pg.pool);
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

    test('save then findById round-trips the envelope', async () => {
      await repo.save(record({
        id: DL_1,
        when: '2026-05-10T10:00:00.000Z',
        env: { type: 'workflow.completed', payload: { wf: 'wf-1' } },
      }));
      const found = await repo.findById(DL_1);
      expect(found).not.toBeNull();
      expect(found.envelope).toEqual({
        kind: 'workflow.event',
        type: 'workflow.completed',
        payload: { wf: 'wf-1' },
      });
      expect(found.attempts).toBe(3);
      expect(found.error).toBe('all retries exhausted');
    });

    test('list returns rows newest-first and respects limit/offset', async () => {
      await repo.save(record({ id: DL_1, when: '2026-05-10T10:00:00.000Z' }));
      await repo.save(record({ id: DL_2, when: '2026-05-10T11:00:00.000Z' }));
      await repo.save(record({ id: DL_3, when: '2026-05-10T12:00:00.000Z' }));
      const all = await repo.list({ limit: 10 });
      expect(all.map((r) => r.id)).toEqual([DL_3, DL_2, DL_1]);
      const page = await repo.list({ limit: 1, offset: 1 });
      expect(page.map((r) => r.id)).toEqual([DL_2]);
    });

    test('delete removes the row', async () => {
      await repo.save(record({ id: DL_1, when: '2026-05-10T10:00:00.000Z' }));
      await repo.delete(DL_1);
      expect(await repo.findById(DL_1)).toBeNull();
    });
  });
});
