import { RegisterUserUseCase } from '../../application/commands/register-user.js';
import { ChangePasswordUseCase } from '../../application/commands/change-password.js';
import { InvalidCredentialsError } from '../../domain/errors.js';
import { NotFoundError } from '../../../../shared-kernel/domain/errors.js';
import { makeFixtures } from './test-fixtures.js';

describe('ChangePasswordUseCase', () => {
  test('rotates hash on success and emits user.password_changed', async () => {
    const f = makeFixtures();
    const reg = new RegisterUserUseCase(f);
    const u = await reg.execute({ email: 'a@b.com', username: 'alice', password: 'old-pass-12' });
    f.outbox.events.length = 0;
    const change = new ChangePasswordUseCase(f);
    await change.execute({ userId: u.id, oldPassword: 'old-pass-12', newPassword: 'new-pass-34' });
    expect(f.outbox.events.map((e) => e.eventType)).toContain('user.password_changed');
  });

  test('rejects wrong old password', async () => {
    const f = makeFixtures();
    const reg = new RegisterUserUseCase(f);
    const u = await reg.execute({ email: 'a@b.com', username: 'alice', password: 'old-pass-12' });
    const change = new ChangePasswordUseCase(f);
    await expect(
      change.execute({ userId: u.id, oldPassword: 'wrong', newPassword: 'new-pass-34' }),
    ).rejects.toThrow(InvalidCredentialsError);
  });

  test('rejects unknown user', async () => {
    const f = makeFixtures();
    const change = new ChangePasswordUseCase(f);
    await expect(
      change.execute({ userId: 'missing', oldPassword: 'x', newPassword: 'new-pass-34' }),
    ).rejects.toThrow(NotFoundError);
  });
});
