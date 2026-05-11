import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../../../shared-kernel/domain/errors.js';
import { ApiKey } from '../../domain/api-key/api-key.js';

/**
 * MintApiKey use case.
 *
 * Authorisation: the actor must be the owner of the target user, OR an admin.
 *   - actor identifier: `cmd.actorUserId`
 *   - actor role:       `cmd.actorRole`
 */
export class MintApiKeyUseCase {
  constructor({
    userRepository,
    apiKeyRepository,
    outbox,
    idGenerator,
    clock,
  }) {
    this.userRepository = userRepository;
    this.apiKeyRepository = apiKeyRepository;
    this.outbox = outbox;
    this.idGenerator = idGenerator;
    this.clock = clock;
  }

  /**
   * @param {{
   *   actorUserId: string,
   *   actorRole?: string,
   *   userId: string,
   *   name: string,
   *   permissions?: string[],
   *   expiresAt?: string|Date|null,
   * }} cmd
   */
  async execute(cmd) {
    if (!cmd || typeof cmd.userId !== 'string') {
      throw new ValidationError('userId required', 'userId');
    }
    if (typeof cmd.name !== 'string' || cmd.name.trim().length === 0) {
      throw new ValidationError('name required', 'name');
    }
    if (cmd.actorUserId !== cmd.userId && cmd.actorRole !== 'admin') {
      throw new ForbiddenError('Only the owner or an admin may mint API keys');
    }

    const user = await this.userRepository.findById(cmd.userId);
    if (!user) throw new NotFoundError('User not found');

    let expiresAt = null;
    if (cmd.expiresAt != null) {
      expiresAt =
        cmd.expiresAt instanceof Date ? cmd.expiresAt : new Date(cmd.expiresAt);
      if (Number.isNaN(expiresAt.getTime())) {
        throw new ValidationError('expiresAt is not a valid date', 'expiresAt');
      }
    }

    const { aggregate, plaintextKey } = ApiKey.mint({
      user: { id: user.id, isActive: user.isActive },
      name: cmd.name,
      permissions: cmd.permissions ?? [],
      expiresAt,
      idGen: this.idGenerator,
      clock: this.clock,
      actor: { type: 'user', id: cmd.actorUserId },
    });

    await this.apiKeyRepository.save(aggregate);
    await this.outbox.enqueue(aggregate.pullEvents());

    return {
      id: aggregate.id.value,
      userId: aggregate.userId,
      name: aggregate.name,
      permissions: aggregate.permissions.map((p) => p.value),
      expiresAt: aggregate.expiresAt
        ? aggregate.expiresAt.toISOString()
        : null,
      createdAt: aggregate.createdAt.toISOString(),
      // Plaintext returned ONCE — never persisted.
      plaintextKey,
    };
  }
}
