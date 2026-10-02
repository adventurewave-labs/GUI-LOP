/**
 * IdentityBackedUserDirectory — the human-interaction view of a user.
 *
 * Regression: it returned `permissions: []` unconditionally, so a pending
 * step with `requiredPermissions` was unanswerable by everyone. Surfaced by
 * the checkJs gate (the result didn't satisfy the UserDirectoryReader port).
 */
import { IdentityBackedUserDirectory } from '../wire-human-interaction.js';
import { Permission } from '../../contexts/identity-and-access/domain/permission/permission.js';
import { InMemoryGrantsRepository } from '../../contexts/identity-and-access/infrastructure/persistence/inmemory-grants-repository.js';
import { EligibilityService } from '../../contexts/human-interaction/domain/services/eligibility-service.js';

const USER = { id: 'u-1', role: { value: 'reviewer' }, isActive: true };
const users = { findById: async (id) => (id === USER.id ? USER : null) };
const roles = {
  findByName: async (name) =>
    name === 'reviewer'
      ? { name, permissions: [new Permission('workflow:read'), new Permission('workflow:respond')] }
      : null,
};

describe('IdentityBackedUserDirectory', () => {
  test('composes role permissions and direct grants; scoped grants contribute scopes', async () => {
    const grants = new InMemoryGrantsRepository();
    await grants.add('u-1', new Permission('invoice:approve'));
    await grants.add('u-1', new Permission('invoice:sign@wf-9'));
    const dir = new IdentityBackedUserDirectory({ userRepository: users, roleRepository: roles, grantsRepository: grants });

    const u = await dir.getUser('u-1');
    expect(u).toEqual({
      id: 'u-1',
      role: 'reviewer',
      isActive: true,
      permissions: ['workflow:read', 'workflow:respond', 'invoice:approve', 'invoice:sign@wf-9'],
      scopes: ['wf-9'],
    });
  });

  test('a permission-gated step is now answerable by a holder, still not by others', async () => {
    const grants = new InMemoryGrantsRepository();
    await grants.add('u-1', new Permission('invoice:approve'));
    const dir = new IdentityBackedUserDirectory({ userRepository: users, roleRepository: roles, grantsRepository: grants });
    const holder = await dir.getUser('u-1');
    // Minimal PendingStep shape the pure eligibility service reads.
    const step = { isClosed: () => false, eligibility: { requiredPermissions: ['invoice:approve'] } };
    const check = (user) => EligibilityService.eligibleFor(user, step, { id: 'wf-1' });
    expect(check(holder)).toBe(true);
    expect(check({ ...holder, permissions: ['workflow:read'] })).toBe(false);
  });

  test('unknown user / missing repositories → null or role-only view', async () => {
    expect(await new IdentityBackedUserDirectory({ userRepository: users }).getUser('nope')).toBeNull();
    expect(await new IdentityBackedUserDirectory().getUser('u-1')).toBeNull();
    const roleOnly = await new IdentityBackedUserDirectory({ userRepository: users, roleRepository: roles }).getUser('u-1');
    expect(roleOnly.permissions).toEqual(['workflow:read', 'workflow:respond']);
    expect(roleOnly.scopes).toEqual([]);
  });
});
