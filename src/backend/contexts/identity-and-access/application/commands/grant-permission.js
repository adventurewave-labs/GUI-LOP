import { ForbiddenError, NotFoundError } from '../../shared-kernel-stubs.js';
import { Permission } from '../../domain/permission/permission.js';
import { PermissionGranted } from '../../domain/events.js';

export class GrantPermissionUseCase {
  constructor({ userRepository, grantsRepository, outbox, clock }) {
    this.userRepository = userRepository;
    this.grantsRepository = grantsRepository;
    this.outbox = outbox;
    this.clock = clock;
  }

  /** @param {{ actorRole: string, userId: string, permission: string, scope?: string }} cmd */
  async execute(cmd) {
    if (cmd.actorRole !== 'admin') {
      throw new ForbiddenError('Only admins may grant permissions');
    }
    const user = await this.userRepository.findById(cmd.userId);
    if (!user) throw new NotFoundError('User not found');

    const perm = cmd.scope
      ? Permission.of(...cmd.permission.split(':'), cmd.scope)
      : new Permission(cmd.permission);

    await this.grantsRepository.add(cmd.userId, perm);
    await this.outbox.enqueue([
      new PermissionGranted({
        userId: cmd.userId,
        permission: perm.value,
        scope: perm.scope,
        occurredAt: this.clock.now(),
      }),
    ]);

    return { permission: perm.value };
  }
}
