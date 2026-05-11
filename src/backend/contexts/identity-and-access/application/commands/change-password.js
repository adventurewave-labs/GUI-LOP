import { NotFoundError } from '../../../../shared-kernel/domain/errors.js';
import { InvalidCredentialsError } from '../../domain/errors.js';

export class ChangePasswordUseCase {
  constructor({ userRepository, passwordHasher, outbox, clock }) {
    this.userRepository = userRepository;
    this.passwordHasher = passwordHasher;
    this.outbox = outbox;
    this.clock = clock;
  }

  /** @param {{ userId: string, oldPassword: string, newPassword: string }} cmd */
  async execute(cmd) {
    if (!cmd.userId) throw new NotFoundError('userId required');
    const user = await this.userRepository.findById(cmd.userId);
    if (!user) throw new NotFoundError('User not found');

    if (typeof cmd.newPassword !== 'string' || cmd.newPassword.length < 8) {
      const err = new Error('newPassword must be at least 8 characters');
      err.code = 'VALIDATION';
      err.field = 'newPassword';
      throw err;
    }

    await user.authenticate(cmd.oldPassword, this.passwordHasher).catch(() => {
      throw new InvalidCredentialsError('Old password does not match');
    });

    const newHash = await this.passwordHasher.hash(cmd.newPassword);
    user.changePassword(newHash, this.clock.now());

    await this.userRepository.save(user);
    await this.outbox.enqueue(user.pullEvents());
  }
}
