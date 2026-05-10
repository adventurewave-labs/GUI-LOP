import { NotFoundError } from '../../../../shared-kernel/domain/errors.js';
export class RevokeSessionUseCase {
  constructor({ sessionRepository, tokenBlacklist, outbox, clock }) {
    this.sessionRepository = sessionRepository;
    this.tokenBlacklist = tokenBlacklist;
    this.outbox = outbox;
    this.clock = clock;
  }

  /** @param {{ sessionId: string, accessJti?: string, accessTtlSeconds?: number }} cmd */
  async execute(cmd) {
    if (!cmd.sessionId) throw new NotFoundError('sessionId required');
    const session = await this.sessionRepository.findById(cmd.sessionId);
    if (!session) throw new NotFoundError('Session not found');

    const now = this.clock.now();
    session.revoke(now);
    await this.sessionRepository.save(session);
    await this.outbox.enqueue(session.pullEvents());

    if (cmd.accessJti && this.tokenBlacklist) {
      const ttl = Math.max(1, cmd.accessTtlSeconds ?? 15 * 60);
      await this.tokenBlacklist.blacklist(cmd.accessJti, ttl);
    }
  }
}
