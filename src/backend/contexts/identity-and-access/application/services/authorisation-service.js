// @ts-check
import { ForbiddenError } from '../../../../shared-kernel/domain/errors.js';
import { Result } from '../../../../shared-kernel/domain/result.js';
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
   * @param {{ userId: string, permission: string, scope?: string|null, ceiling?: string[]|null }} q
   *   `ceiling`: the permissions of the API key the request authenticated
   *   with, when that key was minted with an explicit list. The request is
   *   allowed only if BOTH the user holds the permission AND a ceiling entry
   *   covers it (intersection). Null/empty = no ceiling (session tokens and
   *   unscoped keys inherit the owner's permissions, as before).
   * @returns {Promise<boolean>} resolves true on allow, throws ForbiddenError on deny
   */
  async ensure(q) {
    const result = await this.evaluate(q);
    if (result.isFail()) throw result.error;
    return true;
  }

  /**
   * @param {{ userId: string, permission: string | Permission, scope?: string|null, ceiling?: string[]|null }} q
   */
  async evaluate({ userId, permission, scope = null, ceiling = null }) {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      return Result.fail(new ForbiddenError('Unknown user'));
    }
    const [role, grants] = await Promise.all([
      this.roleRepository.findByName(user.role.value),
      this.grantsRepository?.list?.(userId) ?? Promise.resolve([]),
    ]);
    const rolePerms = role?.permissions ?? [];
    const allPerms = [...rolePerms, ...grants];
    const required = typeof permission === 'string' ? new Permission(permission) : permission;
    const decision = isAuthorised(
      { id: user.id, role: user.role, isActive: user.isActive },
      allPerms,
      required,
      scope ?? null,
    );
    if (decision.isFail() || !Array.isArray(ceiling) || ceiling.length === 0) return decision;
    // API-key ceiling. Previously key permissions were carried on the
    // principal but never consulted, so a key minted as `workflow:read`
    // could do anything its owner could. Even admins are bounded by it.
    // Same scoping rule as the policy: a call-site scope narrows an unscoped need.
    const want = required.scope == null && scope
      ? Permission.of(required.resource, required.action, scope)
      : required;
    const allowed = ceiling.some((c) => {
      try {
        return new Permission(String(c)).covers(want);
      } catch {
        return false;
      }
    });
    return allowed
      ? decision
      : Result.fail(new ForbiddenError(`API key is not scoped for ${want.value}`));
  }
}
