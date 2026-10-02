/**
 * GrantsRepository contract suite (direct per-user permissions).
 *
 * Asserts, for the in-memory and Postgres adapters alike:
 *   - add + list round-trips scoped and unscoped grants, in grant order
 *   - add is idempotent for an identical active grant
 *   - remove revokes exactly the matching (permission, scope) and nothing else
 *   - a revoked grant can be granted again
 *   - unknown / malformed user ids list as empty
 */
import { describeIfDocker } from '../_helpers/docker-available.js';
import { startPostgres } from '../_fixtures/postgres.js';
import { InMemoryGrantsRepository } from '../../../src/backend/contexts/identity-and-access/infrastructure/persistence/inmemory-grants-repository.js';
import { PgGrantsRepository } from '../../../src/backend/contexts/identity-and-access/infrastructure/persistence/pg-grants-repository.js';
import { Permission } from '../../../src/backend/contexts/identity-and-access/domain/permission/permission.js';
import { User } from '../../../src/backend/contexts/identity-and-access/domain/user/user.js';
import { EmailAddress } from '../../../src/backend/contexts/identity-and-access/domain/user/email-address.js';
import { Username } from '../../../src/backend/contexts/identity-and-access/domain/user/username.js';
import { PasswordHash } from '../../../src/backend/contexts/identity-and-access/domain/user/password-hash.js';
import { RoleName } from '../../../src/backend/contexts/identity-and-access/domain/user/role-name.js';
import { PgUserRepository } from '../../../src/backend/contexts/identity-and-access/infrastructure/persistence/pg-user-repository.js';

const USER = '88888888-8888-4888-8888-888888888888';
const NOW = new Date('2026-05-10T10:00:00.000Z');
const values = (perms) => perms.map((p) => p.value);

async function seedUser(pool) {
  await new PgUserRepository(pool).save(User.register({
    id: USER,
    email: new EmailAddress('grants-owner@example.com'),
    username: new Username('grants_owner'),
    passwordHash: PasswordHash.fromTrustedHash('$2b$12$hash.placeholder'),
    role: RoleName.user(),
    now: NOW,
  }));
}

describeIfDocker('GrantsRepository contract', () => {
  let pg;
  const make = {
    'in-memory': () => new InMemoryGrantsRepository(),
    postgres: () => null,
  };

  beforeAll(async () => {
    pg = await startPostgres();
    make.postgres = () => new PgGrantsRepository(pg.pool);
  }, 90_000);

  afterAll(async () => {
    if (pg) await pg.cleanup();
  });

  beforeEach(async () => {
    if (pg) {
      await pg.truncate();
      await seedUser(pg.pool);
    }
  });

  describe.each([['in-memory'], ['postgres']])('%s adapter', (label) => {
    let repo;
    beforeEach(() => { repo = make[label](); });

    test('add + list round-trips scoped and unscoped grants in grant order', async () => {
      await repo.add(USER, new Permission('invoice:approve'));
      await repo.add(USER, new Permission('invoice:sign@wf-9'));
      const got = await repo.list(USER);
      expect(values(got)).toEqual(['invoice:approve', 'invoice:sign@wf-9']);
      expect(got[1]).toBeInstanceOf(Permission);
      expect(got[1].scope).toBe('wf-9');
    });

    test('add is idempotent for an identical active grant', async () => {
      await repo.add(USER, new Permission('invoice:approve'));
      await repo.add(USER, new Permission('invoice:approve'));
      await repo.add(USER, new Permission('invoice:approve@wf-1'));
      expect(values(await repo.list(USER))).toEqual(['invoice:approve', 'invoice:approve@wf-1']);
    });

    test('remove revokes exactly the matching (permission, scope)', async () => {
      await repo.add(USER, new Permission('invoice:approve'));
      await repo.add(USER, new Permission('invoice:approve@wf-1'));
      await repo.remove(USER, new Permission('invoice:approve'));
      expect(values(await repo.list(USER))).toEqual(['invoice:approve@wf-1']);
      await repo.remove(USER, new Permission('invoice:approve@wf-1'));
      expect(await repo.list(USER)).toEqual([]);
    });

    test('a revoked grant can be granted again', async () => {
      await repo.add(USER, new Permission('invoice:approve'));
      await repo.remove(USER, new Permission('invoice:approve'));
      await repo.add(USER, new Permission('invoice:approve'));
      expect(values(await repo.list(USER))).toEqual(['invoice:approve']);
    });

    test('unknown or malformed user ids list as empty', async () => {
      expect(await repo.list('99999999-9999-4999-8999-999999999999')).toEqual([]);
      expect(await repo.list('not-a-uuid')).toEqual([]);
    });
  });

  test('postgres keeps revoked rows for the audit trail', async () => {
    const repo = make.postgres();
    await repo.add(USER, new Permission('invoice:approve'));
    await repo.remove(USER, new Permission('invoice:approve'));
    const { rows } = await pg.pool.query(
      'SELECT revoked_at FROM user_permissions WHERE user_id = $1', [USER],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].revoked_at).not.toBeNull();
  });
});
