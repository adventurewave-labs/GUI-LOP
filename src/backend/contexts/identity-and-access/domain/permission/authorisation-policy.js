import { ForbiddenError } from '../../../../shared-kernel/domain/errors.js';
import { Result } from '../../../../shared-kernel/domain/result.js';
import { Permission } from './permission.js';

/**
 * Pure authorisation policy.
 *
 * @param {{ id: string, role: { value: string }, isActive: boolean }} user
 *   The principal we are evaluating.
 * @param {Permission[]} permissions
 *   The permissions currently granted to the principal (role
 *   permissions plus any direct grants).
 * @param {Permission|string} required
 *   The permission required to perform the action.
 * @param {string|null} [scope]
 *   Optional resource scope to evaluate against. When provided the
 *   `required` permission is treated as scoped to it (a scope on
 *   `required` itself wins).
 * @returns {Result<true, ForbiddenError>}
 */
export function isAuthorised(user, permissions, required, scope = null) {
  if (!user || user.isActive === false) {
    return Result.fail(new ForbiddenError('User is not active'));
  }
  const need = required instanceof Permission
    ? required
    : new Permission(required);
  const scopedNeed = need.scope == null && scope
    ? Permission.of(need.resource, need.action, scope)
    : need;

  // Admins implicitly hold every permission.
  if (user.role?.value === 'admin') {
    return Result.ok(true);
  }

  for (const granted of permissions ?? []) {
    if (granted.covers(scopedNeed)) {
      return Result.ok(true);
    }
  }
  return Result.fail(
    new ForbiddenError(`Permission denied: ${scopedNeed.value}`),
  );
}
