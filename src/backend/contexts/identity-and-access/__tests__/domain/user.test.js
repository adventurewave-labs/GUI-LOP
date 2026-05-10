import { User } from '../../domain/user/user.js';
import { EmailAddress } from '../../domain/user/email-address.js';
import { Username } from '../../domain/user/username.js';
import { PasswordHash } from '../../domain/user/password-hash.js';
import { RoleName } from '../../domain/user/role-name.js';
import {
  InvalidCredentialsError,
  UserDeactivatedError,
} from '../../domain/errors.js';
import { ConflictError, ValidationError } from '../../shared-kernel-stubs.js';

const sampleProps = () => ({
  id: 'u-1',
  email: new EmailAddress('Test@Example.com'),
  username: new Username('alice'),
  passwordHash: PasswordHash.fromTrustedHash('h1'),
  role: RoleName.user(),
});

const fakeHasher = {
  async verify(plain, hash) {
    return hash.value === `h:${plain}`;
  },
};

describe('EmailAddress', () => {
  test('lower-cases and trims', () => {
    expect(new EmailAddress(' Foo@Example.COM ').value).toBe('foo@example.com');
  });
  test('rejects invalid email', () => {
    expect(() => new EmailAddress('not-an-email')).toThrow(ValidationError);
  });
});

describe('Username', () => {
  test('accepts valid', () => {
    expect(new Username('a-b_3').value).toBe('a-b_3');
  });
  test('rejects too-short', () => {
    expect(() => new Username('ab')).toThrow(ValidationError);
  });
  test('rejects bad chars', () => {
    expect(() => new Username('Alice!')).toThrow(ValidationError);
  });
});

describe('PasswordHash', () => {
  test('cannot be constructed without brand', () => {
    expect(() => new PasswordHash(Symbol('x'), 'h')).toThrow(ValidationError);
  });
  test('redacts toString/toJSON', () => {
    const h = PasswordHash.fromTrustedHash('secret');
    expect(String(h)).not.toContain('secret');
    expect(JSON.stringify(h)).not.toContain('secret');
  });
});

describe('RoleName', () => {
  test('accepts admin/user/viewer', () => {
    for (const r of ['admin', 'user', 'viewer']) {
      expect(new RoleName(r).value).toBe(r);
    }
  });
  test('rejects unknown role', () => {
    expect(() => new RoleName('superadmin')).toThrow(ValidationError);
  });
});

describe('User aggregate', () => {
  test('register emits user.registered and bumps no version', () => {
    const u = User.register(sampleProps());
    const events = u.pullEvents();
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('user.registered');
    expect(events[0].payload.userId).toBe('u-1');
    expect(u.pullEvents()).toHaveLength(0); // drained
    expect(u.version).toBe(0);
  });

  test('changeEmail emits event and bumps version', () => {
    const u = User.register(sampleProps());
    u.pullEvents();
    u.changeEmail(new EmailAddress('new@example.com'));
    const events = u.pullEvents();
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('user.email_changed');
    expect(u.version).toBe(1);
    expect(u.email.value).toBe('new@example.com');
  });

  test('changeEmail noop when same', () => {
    const u = User.register(sampleProps());
    u.pullEvents();
    u.changeEmail(new EmailAddress('test@example.com'));
    expect(u.pullEvents()).toHaveLength(0);
    expect(u.version).toBe(0);
  });

  test('changeUsername emits event', () => {
    const u = User.register(sampleProps());
    u.pullEvents();
    u.changeUsername(new Username('bob'));
    expect(u.pullEvents().map((e) => e.eventType)).toEqual([
      'user.username_changed',
    ]);
  });

  test('changePassword emits event, hashes are opaque', () => {
    const u = User.register(sampleProps());
    u.pullEvents();
    u.changePassword(PasswordHash.fromTrustedHash('h2'));
    expect(u.pullEvents().map((e) => e.eventType)).toEqual([
      'user.password_changed',
    ]);
    expect(u.passwordHash.value).toBe('h2');
  });

  test('deactivate then reactivate', () => {
    const u = User.register(sampleProps());
    u.pullEvents();
    u.deactivate();
    expect(u.isActive).toBe(false);
    expect(() => u.deactivate()).toThrow(ConflictError);
    u.reactivate();
    expect(u.isActive).toBe(true);
    expect(() => u.reactivate()).toThrow(ConflictError);
    const events = u.pullEvents();
    expect(events.map((e) => e.eventType)).toEqual([
      'user.deactivated',
      'user.reactivated',
    ]);
  });

  test('authenticate fails when deactivated', async () => {
    const u = User.register(sampleProps());
    u.deactivate();
    await expect(u.authenticate('p', fakeHasher)).rejects.toThrow(
      UserDeactivatedError,
    );
  });

  test('authenticate throws on bad password', async () => {
    const props = sampleProps();
    props.passwordHash = PasswordHash.fromTrustedHash('h:right');
    const u = User.register(props);
    await expect(u.authenticate('wrong', fakeHasher)).rejects.toThrow(
      InvalidCredentialsError,
    );
  });

  test('authenticate succeeds with right password', async () => {
    const props = sampleProps();
    props.passwordHash = PasswordHash.fromTrustedHash('h:right');
    const u = User.register(props);
    await expect(u.authenticate('right', fakeHasher)).resolves.toBe(true);
  });

  test('recordLogin updates lastLogin without event', () => {
    const u = User.register(sampleProps());
    u.pullEvents();
    const t = new Date('2026-01-01T00:00:00Z');
    u.recordLogin(t);
    expect(u.lastLogin).toBe(t);
    expect(u.pullEvents()).toHaveLength(0);
  });
});
