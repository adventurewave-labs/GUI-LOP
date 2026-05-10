import { NotFoundError } from '../../shared-kernel-stubs.js';

export class GetUserProfileQuery {
  constructor({ userRepository }) {
    this.userRepository = userRepository;
  }

  /** @param {{ userId: string }} q */
  async execute(q) {
    const user = await this.userRepository.findById(q.userId);
    if (!user) throw new NotFoundError('User not found');
    return {
      id: user.id,
      email: user.email.value,
      username: user.username.value,
      role: user.role.value,
      fullName: user.fullName,
      isActive: user.isActive,
      createdAt: user.createdAt?.toISOString?.() ?? null,
      updatedAt: user.updatedAt?.toISOString?.() ?? null,
      lastLogin: user.lastLogin?.toISOString?.() ?? null,
    };
  }
}
