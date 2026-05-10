import { Permission } from '../../domain/permission/permission.js';
import { isAuthorised } from '../../domain/permission/authorisation-policy.js';
import { ForbiddenError, ValidationError } from '../../shared-kernel-stubs.js';
import { RoleName } from '../../domain/user/role-name.js';

describe('Permission VO', () => {
  test('parses unscoped permission', () => {
    const p = new Permission('workflow:read');
    expect(p.resource).toBe('workflow');
    expect(p.action).toBe('read');
    expect(p.scope).toBeNull();
    expect(p.value).toBe('workflow:read');
  });

  test('parses scoped permission', () => {
    const p = new Permission('workflow:respond@wf-42');
    expect(p.resource).toBe('workflow');
    expect(p.action).toBe('respond');
    expect(p.scope).toBe('wf-42');
    expect(p.value).toBe('workflow:respond@wf-42');
  });

  test('rejects malformed permission', () => {
    expect(() => new Permission('justone')).toThrow(ValidationError);
    expect(() => new Permission('a:b:c')).toThrow(ValidationError);
    expect(() => new Permission('Workflow:Read@')).toThrow(ValidationError);
  });

  test('covers: unscoped covers scoped', () => {
    const granted = new Permission('workflow:read');
    expect(granted.covers(new Permission('workflow:read@wf-1'))).toBe(true);
    expect(granted.covers(new Permission('workflow:read'))).toBe(true);
  });

  test('covers: scoped does not cover other scopes', () => {
    const granted = new Permission('workflow:read@wf-1');
    expect(granted.covers(new Permission('workflow:read@wf-2'))).toBe(false);
    expect(granted.covers(new Permission('workflow:read@wf-1'))).toBe(true);
    expect(granted.covers(new Permission('workflow:read'))).toBe(false);
  });
});

describe('AuthorisationPolicy', () => {
  const user = (overrides = {}) => ({
    id: 'u',
    role: RoleName.user(),
    isActive: true,
    ...overrides,
  });

  test('admin gets everything', () => {
    const r = isAuthorised(
      user({ role: RoleName.admin() }),
      [],
      'user:manage',
    );
    expect(r.isOk()).toBe(true);
  });

  test('user with permission allowed', () => {
    const r = isAuthorised(user(), [new Permission('workflow:read')], 'workflow:read');
    expect(r.isOk()).toBe(true);
  });

  test('user without permission denied', () => {
    const r = isAuthorised(user(), [], 'workflow:read');
    expect(r.isFail()).toBe(true);
    expect(r.error).toBeInstanceOf(ForbiddenError);
  });

  test('inactive user denied even with grants', () => {
    const r = isAuthorised(
      user({ isActive: false }),
      [new Permission('workflow:read')],
      'workflow:read',
    );
    expect(r.isFail()).toBe(true);
  });

  test('scope param is honoured', () => {
    const r = isAuthorised(
      user(),
      [new Permission('workflow:read@wf-1')],
      'workflow:read',
      'wf-1',
    );
    expect(r.isOk()).toBe(true);
    const r2 = isAuthorised(
      user(),
      [new Permission('workflow:read@wf-1')],
      'workflow:read',
      'wf-2',
    );
    expect(r2.isFail()).toBe(true);
  });
});
