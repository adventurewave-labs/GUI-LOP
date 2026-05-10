import {
  ForbiddenError,
  ValidationError,
} from '../../../../shared-kernel/domain/errors.js';

/**
 * ListApiKeysForUser query.
 *
 * Returns the active (non-revoked) API keys for a user. Plaintext is NEVER
 * exposed — only metadata (id, name, permissions, timestamps).
 *
 * Authorisation: actor must be the owner OR an admin.
 */
export class ListApiKeysForUserQuery {
  constructor({ apiKeyRepository }) {
    this.apiKeyRepository = apiKeyRepository;
  }

  /**
   * @param {{ actorUserId: string, actorRole?: string, userId: string }} q
   */
  async execute(q) {
    if (!q || typeof q.userId !== 'string') {
      throw new ValidationError('userId required', 'userId');
    }
    if (q.actorUserId !== q.userId && q.actorRole !== 'admin') {
      throw new ForbiddenError(
        'Only the owner or an admin may list these API keys',
      );
    }
    const keys = await this.apiKeyRepository.findActiveByUser(q.userId);
    return keys.map((k) => ({
      id: k.id.value,
      userId: k.userId,
      name: k.name,
      permissions: k.permissions.map((p) => p.value),
      expiresAt: k.expiresAt ? k.expiresAt.toISOString() : null,
      lastUsedAt: k.lastUsedAt ? k.lastUsedAt.toISOString() : null,
      createdAt: k.createdAt ? k.createdAt.toISOString() : null,
      isActive: k.isActive,
    }));
  }
}
