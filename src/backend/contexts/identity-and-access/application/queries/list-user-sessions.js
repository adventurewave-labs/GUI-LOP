export class ListUserSessionsQuery {
  constructor({ sessionRepository }) {
    this.sessionRepository = sessionRepository;
  }

  /** @param {{ userId: string }} q */
  async execute(q) {
    const sessions = await this.sessionRepository.findByUserId(q.userId);
    return sessions.map((s) => ({
      id: s.id,
      userId: s.userId,
      ip: s.ip,
      userAgent: s.userAgent,
      createdAt: s.createdAt?.toISOString?.() ?? null,
      expiresAt: s.expiresAt?.toISOString?.() ?? null,
      lastSeenAt: s.lastSeenAt?.toISOString?.() ?? null,
      isActive: s.isActive,
    }));
  }
}
