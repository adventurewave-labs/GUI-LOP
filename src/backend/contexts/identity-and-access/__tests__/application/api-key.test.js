import { MintApiKeyUseCase } from '../../application/commands/mint-api-key.js';
import { RevokeApiKeyUseCase } from '../../application/commands/revoke-api-key.js';
import { AuthenticateWithApiKeyUseCase } from '../../application/commands/authenticate-with-api-key.js';
import { ListApiKeysForUserQuery } from '../../application/queries/list-api-keys-for-user.js';
import { RegisterUserUseCase } from '../../application/commands/register-user.js';
import {
  ForbiddenError,
  NotFoundError,
  UnauthorisedError,
} from '../../../../shared-kernel/domain/errors.js';
import { makeFixtures, makeUuidIdGen, makeFixedClock } from './test-fixtures.js';

function buildEnv() {
  const f = makeFixtures({ idGenerator: makeUuidIdGen() });
  return f;
}

async function registerAlice(f) {
  const reg = new RegisterUserUseCase(f);
  return reg.execute({
    email: 'alice@example.com',
    username: 'alice',
    password: 'longenuf1',
  });
}

describe('MintApiKey', () => {
  test('owner can mint a key for themselves; plaintext returned exactly once', async () => {
    const f = buildEnv();
    const u = await registerAlice(f);
    const mint = new MintApiKeyUseCase(f);
    const out = await mint.execute({
      actorUserId: u.id,
      actorRole: 'user',
      userId: u.id,
      name: 'CI key',
    });
    expect(out.plaintextKey).toMatch(/^glop_/);
    expect(out.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(out.userId).toBe(u.id);
    // Audit event is emitted.
    expect(f.outbox.events.map((e) => e.eventType)).toContain('api_key.minted');
    // List endpoint never exposes plaintext.
    const list = new ListApiKeysForUserQuery(f);
    const items = await list.execute({
      actorUserId: u.id,
      actorRole: 'user',
      userId: u.id,
    });
    expect(items[0]).not.toHaveProperty('plaintextKey');
    expect(items[0].id).toBe(out.id);
  });

  test('non-owner non-admin cannot mint for another user', async () => {
    const f = buildEnv();
    const u = await registerAlice(f);
    const mint = new MintApiKeyUseCase(f);
    await expect(
      mint.execute({
        actorUserId: 'someone-else',
        actorRole: 'user',
        userId: u.id,
        name: 'illicit',
      }),
    ).rejects.toThrow(ForbiddenError);
  });

  test('admin can mint on behalf of any user', async () => {
    const f = buildEnv();
    const u = await registerAlice(f);
    const mint = new MintApiKeyUseCase(f);
    const out = await mint.execute({
      actorUserId: 'admin-1',
      actorRole: 'admin',
      userId: u.id,
      name: 'admin-issued',
    });
    expect(out.id).toBeDefined();
  });

  test('returns 404 when user does not exist', async () => {
    const f = buildEnv();
    const mint = new MintApiKeyUseCase(f);
    await expect(
      mint.execute({
        actorUserId: 'admin',
        actorRole: 'admin',
        userId: 'no-such-user',
        name: 'x',
      }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe('AuthenticateWithApiKey', () => {
  test('happy path returns principal and emits api_key.used', async () => {
    const f = buildEnv();
    const u = await registerAlice(f);
    const mint = new MintApiKeyUseCase(f);
    const minted = await mint.execute({
      actorUserId: u.id,
      actorRole: 'user',
      userId: u.id,
      name: 'CI',
    });
    const auth = new AuthenticateWithApiKeyUseCase(f);
    const principal = await auth.execute({ rawKey: minted.plaintextKey });
    expect(principal.userId).toBe(u.id);
    expect(principal.role).toBe('user');
    expect(principal.apiKeyId).toBe(minted.id);
    expect(f.outbox.events.map((e) => e.eventType)).toContain('api_key.used');
  });

  test('revoked key fails with UnauthorisedError', async () => {
    const f = buildEnv();
    const u = await registerAlice(f);
    const mint = new MintApiKeyUseCase(f);
    const revoke = new RevokeApiKeyUseCase(f);
    const auth = new AuthenticateWithApiKeyUseCase(f);
    const minted = await mint.execute({
      actorUserId: u.id,
      actorRole: 'user',
      userId: u.id,
      name: 'temp',
    });
    await revoke.execute({
      actorUserId: u.id,
      actorRole: 'user',
      apiKeyId: minted.id,
    });
    await expect(auth.execute({ rawKey: minted.plaintextKey })).rejects.toThrow(
      UnauthorisedError,
    );
  });

  test('expired key fails with UnauthorisedError', async () => {
    const clock = makeFixedClock();
    const f = makeFixtures({ idGenerator: makeUuidIdGen(), clock });
    const u = await registerAlice(f);
    const mint = new MintApiKeyUseCase(f);
    const minted = await mint.execute({
      actorUserId: u.id,
      actorRole: 'user',
      userId: u.id,
      name: 'short-lived',
      expiresAt: new Date(clock.now().getTime() + 1000).toISOString(),
    });
    clock.advance(60_000);
    const auth = new AuthenticateWithApiKeyUseCase(f);
    await expect(auth.execute({ rawKey: minted.plaintextKey })).rejects.toThrow(
      UnauthorisedError,
    );
  });

  test('unknown key fails generically', async () => {
    const f = buildEnv();
    const auth = new AuthenticateWithApiKeyUseCase(f);
    // Well-formed prefix but never minted.
    const fakeKey =
      'glop_' + 'A'.repeat(43); // base64url 43 chars
    await expect(auth.execute({ rawKey: fakeKey })).rejects.toThrow(
      UnauthorisedError,
    );
  });

  test('non-glop tokens are rejected', async () => {
    const f = buildEnv();
    const auth = new AuthenticateWithApiKeyUseCase(f);
    await expect(auth.execute({ rawKey: 'not-an-api-key' })).rejects.toThrow(
      UnauthorisedError,
    );
  });

  test('deactivated user cannot authenticate even with a valid key', async () => {
    const f = buildEnv();
    const u = await registerAlice(f);
    const mint = new MintApiKeyUseCase(f);
    const minted = await mint.execute({
      actorUserId: u.id,
      actorRole: 'user',
      userId: u.id,
      name: 'x',
    });
    // Deactivate via the aggregate.
    const user = await f.userRepository.findById(u.id);
    user.deactivate();
    await f.userRepository.save(user);
    const auth = new AuthenticateWithApiKeyUseCase(f);
    await expect(auth.execute({ rawKey: minted.plaintextKey })).rejects.toThrow(
      UnauthorisedError,
    );
  });
});

describe('RevokeApiKey', () => {
  test('owner can revoke their own key (idempotent)', async () => {
    const f = buildEnv();
    const u = await registerAlice(f);
    const mint = new MintApiKeyUseCase(f);
    const revoke = new RevokeApiKeyUseCase(f);
    const minted = await mint.execute({
      actorUserId: u.id,
      actorRole: 'user',
      userId: u.id,
      name: 'k',
    });
    const out1 = await revoke.execute({
      actorUserId: u.id,
      actorRole: 'user',
      apiKeyId: minted.id,
    });
    expect(out1.revokedAt).not.toBeNull();
    // Second call is idempotent — no extra event emitted.
    const before = f.outbox.events.filter(
      (e) => e.eventType === 'api_key.revoked',
    ).length;
    await revoke.execute({
      actorUserId: u.id,
      actorRole: 'user',
      apiKeyId: minted.id,
    });
    const after = f.outbox.events.filter(
      (e) => e.eventType === 'api_key.revoked',
    ).length;
    expect(after).toBe(before);
  });

  test('a different user cannot revoke another user\'s key', async () => {
    const f = buildEnv();
    const u = await registerAlice(f);
    const mint = new MintApiKeyUseCase(f);
    const revoke = new RevokeApiKeyUseCase(f);
    const minted = await mint.execute({
      actorUserId: u.id,
      actorRole: 'user',
      userId: u.id,
      name: 'k',
    });
    await expect(
      revoke.execute({
        actorUserId: 'other-user',
        actorRole: 'user',
        apiKeyId: minted.id,
      }),
    ).rejects.toThrow(ForbiddenError);
  });

  test('admin can revoke any key', async () => {
    const f = buildEnv();
    const u = await registerAlice(f);
    const mint = new MintApiKeyUseCase(f);
    const revoke = new RevokeApiKeyUseCase(f);
    const minted = await mint.execute({
      actorUserId: u.id,
      actorRole: 'user',
      userId: u.id,
      name: 'k',
    });
    const out = await revoke.execute({
      actorUserId: 'admin-1',
      actorRole: 'admin',
      apiKeyId: minted.id,
    });
    expect(out.revokedAt).not.toBeNull();
  });

  test('revoking unknown key returns 404', async () => {
    const f = buildEnv();
    const revoke = new RevokeApiKeyUseCase(f);
    await expect(
      revoke.execute({
        actorUserId: 'admin',
        actorRole: 'admin',
        apiKeyId: '00000000-0000-4000-8000-000000000099',
      }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe('ListApiKeysForUser', () => {
  test('actor must be owner or admin', async () => {
    const f = buildEnv();
    const u = await registerAlice(f);
    const list = new ListApiKeysForUserQuery(f);
    await expect(
      list.execute({
        actorUserId: 'someone-else',
        actorRole: 'user',
        userId: u.id,
      }),
    ).rejects.toThrow(ForbiddenError);
  });

  test('lists active keys, hides revoked ones', async () => {
    const f = buildEnv();
    const u = await registerAlice(f);
    const mint = new MintApiKeyUseCase(f);
    const revoke = new RevokeApiKeyUseCase(f);
    const list = new ListApiKeysForUserQuery(f);
    const a = await mint.execute({
      actorUserId: u.id, actorRole: 'user', userId: u.id, name: 'a',
    });
    await mint.execute({
      actorUserId: u.id, actorRole: 'user', userId: u.id, name: 'b',
    });
    await revoke.execute({
      actorUserId: u.id, actorRole: 'user', apiKeyId: a.id,
    });
    const items = await list.execute({
      actorUserId: u.id, actorRole: 'user', userId: u.id,
    });
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe('b');
  });
});
