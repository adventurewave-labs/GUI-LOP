/**
 * UserRepository contract suite.
 *
 * Asserts the same behaviour for the in-memory and Postgres adapters:
 *   - `save` + `findById` round-trips a freshly registered user.
 *   - `findByEmail` lookup is case-insensitive (the EmailAddress VO
 *     normalises to lower-case, so feeding it an upper-cased string
 *     still resolves the row).
 *   - `findByUsername` is exact-match.
 *   - The `is_active` flag survives the round-trip after
 *     `user.deactivate()`.
 *   - Email uniqueness is enforced at the database level (Postgres)
 *     and at the aggregate-level conflict throw (in-memory). We only
 *     assert the Postgres path here because the in-memory adapter
 *     accepts duplicate-email saves by design (the use case layer
 *     guards instead).
 */

import { describeIfDocker } from '../_helpers/docker-available.js';
import { startPostgres } from '../_fixtures/postgres.js';
import { InMemoryUserRepository } from '../../../src/backend/contexts/identity-and-access/infrastructure/persistence/inmemory-user-repository.js';
import { PgUserRepository } from '../../../src/backend/contexts/identity-and-access/infrastructure/persistence/pg-user-repository.js';
import { User } from '../../../src/backend/contexts/identity-and-access/domain/user/user.js';
import { EmailAddress } from '../../../src/backend/contexts/identity-and-access/domain/user/email-address.js';
import { Username } from '../../../src/backend/contexts/identity-and-access/domain/user/username.js';
import { PasswordHash } from '../../../src/backend/contexts/identity-and-access/domain/user/password-hash.js';
import { RoleName } from '../../../src/backend/contexts/identity-and-access/domain/user/role-name.js';

const FIXED_NOW = new Date('2026-05-10T10:00:00.000Z');
const USER_A = '44444444-4444-4444-4444-444444444444';
const USER_B = '44444444-4444-4444-4444-444444444445';

function buildUser({ id = USER_A, email = 'alice@example.com', username = 'alice' } = {}) {
  return User.register({
    id,
    email: new EmailAddress(email),
    username: new Username(username),
    passwordHash: PasswordHash.fromTrustedHash('$2b$12$hash.placeholder'),
    role: RoleName.user(),
    now: FIXED_NOW,
  });
}

describeIfDocker('UserRepository contract', () => {
  let pg;
  const make = {
    'in-memory': () => new InMemoryUserRepository(),
    'postgres': () => null,
  };

  beforeAll(async () => {
    pg = await startPostgres();
    make.postgres = () => new PgUserRepository(pg.pool);
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

    test('save then findById round-trips a User', async () => {
      const u = buildUser();
      await repo.save(u);
      const found = await repo.findById(USER_A);
      expect(found).not.toBeNull();
      expect(found.id).toBe(USER_A);
      expect(found.email.value).toBe('alice@example.com');
      expect(found.username.value).toBe('alice');
      expect(found.role.value).toBe('user');
      expect(found.isActive).toBe(true);
    });

    test('findByEmail matches lowercased input (EmailAddress normalises)', async () => {
      await repo.save(buildUser());
      // Email VO normalises 'Alice@Example.com' -> 'alice@example.com'
      const found = await repo.findByEmail(new EmailAddress('Alice@Example.com'));
      expect(found).not.toBeNull();
      expect(found.id).toBe(USER_A);
    });

    test('findByUsername finds by exact username', async () => {
      await repo.save(buildUser());
      const found = await repo.findByUsername(new Username('alice'));
      expect(found).not.toBeNull();
      expect(found.id).toBe(USER_A);
    });

    test('deactivation flag survives a round-trip', async () => {
      const u = buildUser();
      u.deactivate(FIXED_NOW);
      await repo.save(u);
      const reloaded = await repo.findById(USER_A);
      expect(reloaded.isActive).toBe(false);
    });

    test('findById returns null for missing user', async () => {
      expect(await repo.findById('00000000-0000-0000-0000-000000000000')).toBeNull();
    });
  });

  // Postgres-only: uniqueness constraints.
  test('postgres rejects a duplicate email', async () => {
    const repo = make.postgres();
    await repo.save(buildUser({ id: USER_A, email: 'alice@example.com', username: 'alice' }));
    await expect(
      repo.save(buildUser({ id: USER_B, email: 'alice@example.com', username: 'alice2' })),
    ).rejects.toThrow();
  });

  test('postgres rejects a duplicate username', async () => {
    const repo = make.postgres();
    await repo.save(buildUser({ id: USER_A, email: 'a@example.com', username: 'shared' }));
    await expect(
      repo.save(buildUser({ id: USER_B, email: 'b@example.com', username: 'shared' })),
    ).rejects.toThrow();
  });
});
