// @ts-check
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../../../shared-kernel/domain/errors.js';

/**
 * ReactivateUser use case (admin only).
 */
export class ReactivateUserUseCase {
  constructor({ userRepository, outbox, clock }) {
    this.userRepository = userRepository;
    this.outbox = outbox;
    this.clock = clock;
  }

  /** @param {{ actorRole: string, actorId?: string | null, userId: string }} cmd */
  async execute(cmd) {
    if (!cmd || typeof cmd.userId !== 'string') {
      throw new ValidationError('userId required', 'userId');
    }
    if (cmd.actorRole !== 'admin') {
      throw new ForbiddenError('Only admins may reactivate users');
    }
    const user = await this.userRepository.findById(cmd.userId);
    if (!user) throw new NotFoundError('User not found');
    user.reactivate(this.clock.now());
    await this.userRepository.save(user);
    await this.outbox.enqueue(user.pullEvents(), { actorId: cmd.actorId ?? null });
    return { id: user.id, isActive: user.isActive };
  }
}
