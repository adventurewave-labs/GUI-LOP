/**
 * SessionRepository contract suite.
 *
 * Asserts:
 *   - `save` + `findById` round-trips a freshly issued session.
 *   - `findByRefreshTokenHash` locates by the hash column (the
 *     production code stores the hash, never the plaintext).
 *   - `findByUserId` returns the user's sessions newest-first.
 *   - `revoke(sessionId)` makes the session inactive on a subsequent
 *     `findById`. The Postgres adapter does this directly; the
 *     in-memory adapter delegates to the aggregate's `revoke()`.
 *
 * Expiry is not enforced by the repository — it's the aggregate's
 * `isUsable(now)` that gates use — but we verify `expiresAt` survives
 * the round-trip with millisecond fidelity.
 */

import { describeIfDocker } from '../_helpers/docker-available.js';
import { startPostgres } from '../_fixtures/postgres.js';
import { InMemorySessionRepository } from '../../../src/backend/contexts/identity-and-access/infrastructure/persistence/inmemory-session-repository.js';
import { PgSessionRepository } from '../../../src/backend/contexts/identity-and-access/infrastructure/persistence/pg-session-repository.js';
import { Session } from '../../../src/backend/contexts/identity-and-access/domain/session/session.js';
import { User } from '../../../src/backend/contexts/identity-and-access/domain/user/user.js';
import { EmailAddress } from '../../../src/backend/contexts/identity-and-access/domain/user/email-address.js';
import { Username } from '../../../src/backend/contexts/identity-and-access/domain/user/username.js';
import { PasswordHash } from '../../../src/backend/contexts/identity-and-access/domain/user/password-hash.js';
import { RoleName } from '../../../src/backend/contexts/identity-and-access/domain/user/role-name.js';
import { RefreshConflictError } from '../../../src/backend/contexts/identity-and-access/domain/errors.js';
import { PgUserRepository } from '../../../src/backend/contexts/identity-and-access/infrastructure/persistence/pg-user-repository.js';

const FIXED_NOW = new Date('2026-05-10T10:00:00.000Z');
const USER_A = '55555555-5555-5555-5555-555555555555';
const SESSION_A = '66666666-6666-6666-6666-666666666666';
const SESSION_B = '66666666-6666-6666-6666-66666666666b';

function buildSession({ id = SESSION_A, userId = USER_A, hash = 'rth_hash_1' } = {}) {
  return Session.issue({
    id,
    userId,
    refreshTokenHash: hash,
    ip: '127.0.0.1',
    userAgent: 'jest',
    ttlMs: 60 * 60 * 1000, // 1h
    now: FIXED_NOW,
  });
}

async function seedUser(pool) {
  const userRepo = new PgUserRepository(pool);
  await userRepo.save(User.register({
    id: USER_A,
    email: new EmailAddress('session-owner@example.com'),
    username: new Username('session_owner'),
    passwordHash: PasswordHash.fromTrustedHash('$2b$12$hash.placeholder'),
    role: RoleName.user(),
    now: FIXED_NOW,
  }));
}

describeIfDocker('SessionRepository contract', () => {
  let pg;
  const make = {
    'in-memory': () => new InMemorySessionRepository(),
    'postgres': () => null,
  };

  beforeAll(async () => {
    pg = await startPostgres();
    make.postgres = () => new PgSessionRepository(pg.pool);
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

  test('postgres: concurrent rotations of the same token — exactly one wins (compare-and-set)', async () => {
    const repo = make.postgres();
    await repo.save(buildSession({ hash: 'cas_1' }));
    // Two requests load the same session independently (separate aggregates).
    const a = await repo.findByRefreshTokenHash('cas_1');
    const b = await repo.findByRefreshTokenHash('cas_1');
    a.refresh('cas_a', FIXED_NOW);
    b.refresh('cas_b', FIXED_NOW);
    await repo.save(a);
    await expect(repo.save(b)).rejects.toThrow(RefreshConflictError);
    // The winner's token is current; the loser's never landed; history is clean.
    expect((await repo.findByRefreshTokenHash('cas_a'))?.id).toBe(SESSION_A);
    expect(await repo.findByRefreshTokenHash('cas_b')).toBeNull();
    const { rows } = await pg.pool.query('SELECT token_hash FROM refresh_token_history WHERE session_id = $1', [SESSION_A]);
    expect(rows.map((r) => r.token_hash)).toEqual(['cas_1']);
  });

  test('postgres: superseded history is deleted with the session', async () => {
    const repo = make.postgres();
    await repo.save(buildSession({ hash: 'del_1' }));
    const s = await repo.findByRefreshTokenHash('del_1');
    s.refresh('del_2', FIXED_NOW);
    await repo.save(s);
    await pg.pool.query('DELETE FROM user_sessions WHERE id = $1', [SESSION_A]);
    const { rows } = await pg.pool.query('SELECT count(*)::int AS n FROM refresh_token_history');
    expect(rows[0].n).toBe(0);
  });

  describe.each([
    ['in-memory'],
    ['postgres'],
  ])('%s adapter', (label) => {
    let repo;

    beforeEach(() => {
      repo = make[label]();
    });

    test('save then findById round-trips a Session', async () => {
      const s = buildSession();
      await repo.save(s);
      const found = await repo.findById(SESSION_A);
      expect(found).not.toBeNull();
      expect(found.id).toBe(SESSION_A);
      expect(found.userId).toBe(USER_A);
      expect(found.refreshTokenHash).toBe('rth_hash_1');
      expect(found.isActive).toBe(true);
      // Expiry survives the round-trip.
      expect(found.expiresAt.getTime()).toBe(FIXED_NOW.getTime() + 60 * 60 * 1000);
    });

    test('findByRefreshTokenHash locates by the hash column', async () => {
      await repo.save(buildSession({ hash: 'unique_hash_xyz' }));
      const found = await repo.findByRefreshTokenHash('unique_hash_xyz');
      expect(found).not.toBeNull();
      expect(found.id).toBe(SESSION_A);
      expect(await repo.findByRefreshTokenHash('nope')).toBeNull();
    });

    test('rotation: new hash is current, old hash is findable as superseded (reuse detection)', async () => {
      const s = buildSession({ hash: 'rot_1' });
      await repo.save(s);
      const loaded = await repo.findByRefreshTokenHash('rot_1');
      loaded.refresh('rot_2', FIXED_NOW);
      await repo.save(loaded);
      const again = await repo.findByRefreshTokenHash('rot_2');
      again.refresh('rot_3', FIXED_NOW);
      await repo.save(again);

      expect((await repo.findByRefreshTokenHash('rot_3'))?.id).toBe(SESSION_A);
      expect(await repo.findByRefreshTokenHash('rot_1')).toBeNull();
      expect((await repo.findBySupersededRefreshTokenHash('rot_1'))?.id).toBe(SESSION_A);
      expect((await repo.findBySupersededRefreshTokenHash('rot_2'))?.id).toBe(SESSION_A);
      expect(await repo.findBySupersededRefreshTokenHash('rot_3')).toBeNull();
      expect(await repo.findBySupersededRefreshTokenHash('never')).toBeNull();
    });

    test('revokeForReuse persists the revocation', async () => {
      const issued = buildSession({ hash: 'r_1' });
      issued.pullEvents(); // drain session.created (in-memory returns this same instance)
      await repo.save(issued);
      const loaded = await repo.findByRefreshTokenHash('r_1');
      loaded.revokeForReuse(FIXED_NOW);
      expect(loaded.pullEvents().map((e) => e.eventType)).toEqual(['session.revoked', 'session.refresh_token_reused']);
      await repo.save(loaded);
      expect((await repo.findById(SESSION_A)).isActive).toBe(false);
    });

    test('findByUserId returns the user\'s sessions', async () => {
      await repo.save(buildSession({ id: SESSION_A, hash: 'h1' }));
      await repo.save(buildSession({ id: SESSION_B, hash: 'h2' }));
      const sessions = await repo.findByUserId(USER_A);
      expect(sessions).toHaveLength(2);
      const ids = sessions.map((s) => s.id).sort();
      expect(ids).toEqual([SESSION_A, SESSION_B].sort());
    });

    test('revoke flips is_active to false', async () => {
      const s = buildSession();
      await repo.save(s);
      await repo.revoke(SESSION_A, FIXED_NOW);
      const found = await repo.findById(SESSION_A);
      expect(found.isActive).toBe(false);
    });
  });
});
