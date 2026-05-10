import { GrantPermissionUseCase } from '../../application/commands/grant-permission.js';
import { RevokePermissionUseCase } from '../../application/commands/revoke-permission.js';
import { AuthorisationService } from '../../application/services/authorisation-service.js';
import { RegisterUserUseCase } from '../../application/commands/register-user.js';
import { Permission } from '../../domain/permission/permission.js';
import { ForbiddenError } from '../../shared-kernel-stubs.js';
import { makeFixtures } from './test-fixtures.js';

const fakeRoleRepo = (rolePerms = {}) => ({
  async findByName(name) {
    return { name, permissions: (rolePerms[name] ?? []).map((p) => new Permission(p)) };
  },
  async list() { return Object.keys(rolePerms).map((n) => ({ name: n, permissions: [] })); },
});

describe('Grant/Revoke permissions', () => {
  test('admin can grant a scoped permission', async () => {
    const f = makeFixtures();
    const reg = new RegisterUserUseCase(f);
    const u = await reg.execute({ email: 'a@b.com', username: 'alice', password: 'longenuf1' });
    const grant = new GrantPermissionUseCase(f);
    const out = await grant.execute({
      actorRole: 'admin',
      userId: u.id,
      permission: 'workflow:read',
      scope: 'wf-1',
    });
    expect(out.permission).toBe('workflow:read@wf-1');
    expect(f.outbox.events.map((e) => e.eventType)).toContain('permission.granted');
  });

  test('non-admin cannot grant', async () => {
    const f = makeFixtures();
    const reg = new RegisterUserUseCase(f);
    const u = await reg.execute({ email: 'a@b.com', username: 'alice', password: 'longenuf1' });
    const grant = new GrantPermissionUseCase(f);
    await expect(
      grant.execute({ actorRole: 'user', userId: u.id, permission: 'workflow:read' }),
    ).rejects.toThrow(ForbiddenError);
  });

  test('revoke removes the grant', async () => {
    const f = makeFixtures();
    const reg = new RegisterUserUseCase(f);
    const u = await reg.execute({ email: 'a@b.com', username: 'alice', password: 'longenuf1' });
    const grant = new GrantPermissionUseCase(f);
    const revoke = new RevokePermissionUseCase(f);
    await grant.execute({ actorRole: 'admin', userId: u.id, permission: 'workflow:read', scope: 'wf-1' });
    await revoke.execute({ actorRole: 'admin', userId: u.id, permission: 'workflow:read', scope: 'wf-1' });
    const remaining = await f.grantsRepository.list(u.id);
    expect(remaining).toHaveLength(0);
  });
});

describe('AuthorisationService', () => {
  test('admin user always allowed', async () => {
    const f = makeFixtures();
    const reg = new RegisterUserUseCase(f);
    const u = await reg.execute({
      email: 'a@b.com', username: 'alice', password: 'longenuf1', role: 'admin',
    });
    const svc = new AuthorisationService({
      userRepository: f.userRepository,
      roleRepository: fakeRoleRepo({ admin: [], user: [] }),
      grantsRepository: f.grantsRepository,
    });
    await expect(svc.ensure({ userId: u.id, permission: 'user:manage' })).resolves.toBe(true);
  });

  test('user with role permission allowed', async () => {
    const f = makeFixtures();
    const reg = new RegisterUserUseCase(f);
    const u = await reg.execute({ email: 'a@b.com', username: 'alice', password: 'longenuf1' });
    const svc = new AuthorisationService({
      userRepository: f.userRepository,
      roleRepository: fakeRoleRepo({ user: ['workflow:read'] }),
      grantsRepository: f.grantsRepository,
    });
    await expect(svc.ensure({ userId: u.id, permission: 'workflow:read' })).resolves.toBe(true);
  });

  test('user without permission denied', async () => {
    const f = makeFixtures();
    const reg = new RegisterUserUseCase(f);
    const u = await reg.execute({ email: 'a@b.com', username: 'alice', password: 'longenuf1' });
    const svc = new AuthorisationService({
      userRepository: f.userRepository,
      roleRepository: fakeRoleRepo({ user: [] }),
      grantsRepository: f.grantsRepository,
    });
    await expect(svc.ensure({ userId: u.id, permission: 'workflow:read' })).rejects.toThrow(ForbiddenError);
  });

  test('direct grant satisfies authorisation', async () => {
    const f = makeFixtures();
    const reg = new RegisterUserUseCase(f);
    const u = await reg.execute({ email: 'a@b.com', username: 'alice', password: 'longenuf1' });
    await f.grantsRepository.add(u.id, new Permission('workflow:respond@wf-1'));
    const svc = new AuthorisationService({
      userRepository: f.userRepository,
      roleRepository: fakeRoleRepo({ user: [] }),
      grantsRepository: f.grantsRepository,
    });
    await expect(svc.ensure({ userId: u.id, permission: 'workflow:respond', scope: 'wf-1' })).resolves.toBe(true);
    await expect(svc.ensure({ userId: u.id, permission: 'workflow:respond', scope: 'wf-2' })).rejects.toThrow(ForbiddenError);
  });
});
