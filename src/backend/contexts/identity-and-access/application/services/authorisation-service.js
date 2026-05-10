import { ForbiddenError } from '../../shared-kernel-stubs.js';
import { isAuthorised } from '../../domain/permission/authorisation-policy.js';
import { Permission } from '../../domain/permission/permission.js';

/**
 * AuthorisationService composes the user, their role permissions and
 * direct grants, then runs the pure policy. This is the cross-context
 * port the Workflow context (and others) consume.
 */
export class AuthorisationService {
  constructor({ userRepository, roleRepository, grantsRepository }) {
    this.userRepository = userRepository;
    this.roleRepository = roleRepository;
    this.grantsRepository = grantsRepository;
  }

  /**
   * @param {{ userId: string, permission: string, scope?: string|null }} q
   * @returns {Promise<boolean>} resolves true on allow, throws ForbiddenError on deny
   */
  async ensure(q) {
    const result = await this.evaluate(q);
    if (result.isFail()) throw result.error;
    return true;
  }

  async evaluate({ userId, permission, scope }) {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      const { Result } = await import('../../shared-kernel-stubs.js');
      return Result.fail(new ForbiddenError('Unknown user'));
    }
    const [role, grants] = await Promise.all([
      this.roleRepository.findByName(user.role.value),
      this.grantsRepository?.list?.(userId) ?? Promise.resolve([]),
    ]);
    const rolePerms = role?.permissions ?? [];
    const allPerms = [...rolePerms, ...grants];
    return isAuthorised(
      { id: user.id, role: user.role, isActive: user.isActive },
      allPerms,
      typeof permission === 'string' ? new Permission(permission) : permission,
      scope ?? null,
    );
  }
}
