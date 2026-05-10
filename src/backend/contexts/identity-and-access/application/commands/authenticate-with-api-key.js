import { UnauthorisedError } from '../../../../shared-kernel/domain/errors.js';
import { ApiKeySecret } from '../../domain/api-key/api-key-secret.js';

/**
 * AuthenticateWithApiKey use case.
 *
 * Given a raw API key string, locate the matching aggregate by hash, ensure
 * it is usable (active + not expired), record the usage and return a
 * principal-shaped object the auth middleware can attach to the request.
 *
 * Throws `UnauthorisedError` for any failure (missing/unknown/revoked/
 * expired/deactivated). The error message is intentionally generic.
 */
export class AuthenticateWithApiKeyUseCase {
  constructor({ apiKeyRepository, userRepository, outbox, clock }) {
    this.apiKeyRepository = apiKeyRepository;
    this.userRepository = userRepository;
    this.outbox = outbox;
    this.clock = clock;
  }

  /**
   * @param {{ rawKey: string }} cmd
   * @returns {Promise<{ userId: string, role: string, apiKeyId: string }>}
   */
  async execute(cmd) {
    const raw = cmd?.rawKey;
    if (!ApiKeySecret.looksLikeApiKey(raw)) {
      throw new UnauthorisedError('Invalid API key');
    }
    let secret;
    try {
      secret = new ApiKeySecret(raw);
    } catch {
      throw new UnauthorisedError('Invalid API key');
    }
    const hash = secret.hash();
    const key = await this.apiKeyRepository.findByHash(hash);
    if (!key) throw new UnauthorisedError('Invalid API key');

    const now = this.clock.now();
    if (!key.isUsable(now)) {
      // Revoked OR expired — both expressed as a generic 401.
      throw new UnauthorisedError('Invalid API key');
    }

    const user = await this.userRepository.findById(key.userId);
    if (!user || !user.isActive) {
      throw new UnauthorisedError('Invalid API key');
    }

    key.recordUsage(now);
    await this.apiKeyRepository.save(key);
    await this.outbox.enqueue(key.pullEvents());

    return {
      userId: user.id,
      role: user.role.value,
      apiKeyId: key.id.value,
      permissions: key.permissions.map((p) => p.value),
    };
  }
}
