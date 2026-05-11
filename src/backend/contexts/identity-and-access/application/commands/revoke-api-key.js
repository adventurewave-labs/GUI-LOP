import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../../../shared-kernel/domain/errors.js';

/**
 * RevokeApiKey use case.
 *
 * Authorisation: the actor must own the key, OR be an admin.
 * Idempotent: revoking an already-revoked key returns success without
 * re-emitting events.
 */
export class RevokeApiKeyUseCase {
  constructor({ apiKeyRepository, outbox, clock }) {
    this.apiKeyRepository = apiKeyRepository;
    this.outbox = outbox;
    this.clock = clock;
  }

  /**
   * @param {{ actorUserId: string, actorRole?: string, apiKeyId: string }} cmd
   */
  async execute(cmd) {
    if (!cmd || typeof cmd.apiKeyId !== 'string') {
      throw new ValidationError('apiKeyId required', 'apiKeyId');
    }
    const key = await this.apiKeyRepository.findById(cmd.apiKeyId);
    if (!key) throw new NotFoundError('API key not found');

    const isOwner = cmd.actorUserId === key.userId;
    const isAdmin = cmd.actorRole === 'admin';
    if (!isOwner && !isAdmin) {
      throw new ForbiddenError('Only the owner or an admin may revoke this key');
    }

    const wasActive = key.isActive;
    key.revoke(this.clock.now(), {
      type: 'user',
      id: cmd.actorUserId,
    });
    if (wasActive) {
      await this.apiKeyRepository.save(key);
      await this.outbox.enqueue(key.pullEvents());
    }
    return { id: key.id.value, revokedAt: key.revokedAt?.toISOString() ?? null };
  }
}
