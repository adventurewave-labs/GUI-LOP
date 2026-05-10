import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../../../shared-kernel/domain/errors.js';

/**
 * DeactivateUser use case (admin only).
 * Idempotent at the HTTP layer — the aggregate throws ConflictError if
 * already deactivated, which the router maps to 409.
 */
export class DeactivateUserUseCase {
  constructor({ userRepository, outbox, clock }) {
    this.userRepository = userRepository;
    this.outbox = outbox;
    this.clock = clock;
  }

  /** @param {{ actorRole: string, userId: string }} cmd */
  async execute(cmd) {
    if (!cmd || typeof cmd.userId !== 'string') {
      throw new ValidationError('userId required', 'userId');
    }
    if (cmd.actorRole !== 'admin') {
      throw new ForbiddenError('Only admins may deactivate users');
    }
    const user = await this.userRepository.findById(cmd.userId);
    if (!user) throw new NotFoundError('User not found');
    user.deactivate(this.clock.now());
    await this.userRepository.save(user);
    await this.outbox.enqueue(user.pullEvents());
    return { id: user.id, isActive: user.isActive };
  }
}
