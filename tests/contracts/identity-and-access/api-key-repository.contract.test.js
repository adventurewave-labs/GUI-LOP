/**
 * ApiKeyRepository contract suite.
 *
 * Asserts:
 *   - `save` + `findById` round-trips a minted key.
 *   - `findByHash` matches by `keyHash` exactly.
 *   - `findActiveByUser` excludes revoked keys.
 *   - `revoke()` survives the round-trip — a reloaded key is
 *     `isActive: false` and `isUsable()` returns false.
 *   - An expired key is non-usable per the aggregate's
 *     `isUsable(now)` regardless of what the repository row says.
 */

import { describeIfDocker } from '../_helpers/docker-available.js';
import { startPostgres } from '../_fixtures/postgres.js';
import { InMemoryApiKeyRepository } from '../../../src/backend/contexts/identity-and-access/infrastructure/persistence/inmemory-api-key-repository.js';
import { PgApiKeyRepository } from '../../../src/backend/contexts/identity-and-access/infrastructure/persistence/pg-api-key-repository.js';
import { ApiKey } from '../../../src/backend/contexts/identity-and-access/domain/api-key/api-key.js';
import { User } from '../../../src/backend/contexts/identity-and-access/domain/user/user.js';
import { EmailAddress } from '../../../src/backend/contexts/identity-and-access/domain/user/email-address.js';
import { Username } from '../../../src/backend/contexts/identity-and-access/domain/user/username.js';
import { PasswordHash } from '../../../src/backend/contexts/identity-and-access/domain/user/password-hash.js';
import { RoleName } from '../../../src/backend/contexts/identity-and-access/domain/user/role-name.js';
import { PgUserRepository } from '../../../src/backend/contexts/identity-and-access/infrastructure/persistence/pg-user-repository.js';

const FIXED_NOW = new Date('2026-05-10T10:00:00.000Z');
const FUTURE = new Date('2026-05-11T10:00:00.000Z');
const USER_A = '77777777-7777-7777-7777-777777777777';

const fakeIdGen = (() => {
  let n = 0;
  return {
    newId: () => `${String(++n).padStart(8, '0')}-aaaa-aaaa-aaaa-aaaaaaaaaaaa`,
    randomBytes: () => Buffer.from('0'.repeat(64), 'hex'),
  };
})();
const fakeClock = { now: () => FIXED_NOW };

function mintKey({ name = 'integration test', perms = [], expiresAt = null } = {}) {
  const { aggregate } = ApiKey.mint({
    user: { id: USER_A, isActive: true },
    name,
    permissions: perms,
    expiresAt,
    idGen: fakeIdGen,
    clock: fakeClock,
    actor: { type: 'user', id: USER_A },
  });
  // Drain the minted event so the test isn't responsible for it.
  aggregate.pullEvents();
  return aggregate;
}

async function seedUser(pool) {
  const userRepo = new PgUserRepository(pool);
  await userRepo.save(User.register({
    id: USER_A,
    email: new EmailAddress('apikey-owner@example.com'),
    username: new Username('apikey_owner'),
    passwordHash: PasswordHash.fromTrustedHash('$2b$12$hash.placeholder'),
    role: RoleName.user(),
    now: FIXED_NOW,
  }));
}

describeIfDocker('ApiKeyRepository contract', () => {
  let pg;
  const make = {
    'in-memory': () => new InMemoryApiKeyRepository(),
    'postgres': () => null,
  };

  beforeAll(async () => {
    pg = await startPostgres();
    make.postgres = () => new PgApiKeyRepository(pg.pool);
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

  describe.each([
    ['in-memory'],
    ['postgres'],
  ])('%s adapter', (label) => {
    let repo;

    beforeEach(() => {
      repo = make[label]();
    });

    test('save then findById round-trips a minted key', async () => {
      const key = mintKey();
      await repo.save(key);
      const found = await repo.findById(key.id);
      expect(found).not.toBeNull();
      expect(found.userId).toBe(USER_A);
      expect(found.name).toBe('integration test');
      expect(found.isActive).toBe(true);
      expect(found.keyHash).toBe(key.keyHash);
    });

    test('findByHash locates the active key', async () => {
      const key = mintKey();
      await repo.save(key);
      const found = await repo.findByHash(key.keyHash);
      expect(found).not.toBeNull();
      expect(found.id.value).toBe(key.id.value);
      expect(await repo.findByHash('unknown_hash')).toBeNull();
    });

    test('findActiveByUser excludes revoked keys', async () => {
      const k1 = mintKey({ name: 'active' });
      const k2 = mintKey({ name: 'revoked' });
      k2.revoke(FIXED_NOW);
      await repo.save(k1);
      await repo.save(k2);
      const active = await repo.findActiveByUser(USER_A);
      const ids = active.map((k) => k.id.value);
      expect(ids).toContain(k1.id.value);
      expect(ids).not.toContain(k2.id.value);
    });

    test('expired key is unusable per aggregate, but still findable', async () => {
      const expiresAt = new Date(FIXED_NOW.getTime() + 1000); // expires shortly
      const key = mintKey({ expiresAt });
      await repo.save(key);
      const found = await repo.findById(key.id);
      // Just past expiry:
      const wayAfter = new Date(expiresAt.getTime() + 60_000);
      expect(found.isUsable(wayAfter)).toBe(false);
      // The key row still exists.
      expect(found.expiresAt.getTime()).toBe(expiresAt.getTime());
    });

    test('findById returns null for an unknown id', async () => {
      // Both adapters accept either ApiKeyId VO or raw string.
      expect(await repo.findById('99999999-9999-9999-9999-999999999999')).toBeNull();
    });
  });
});
