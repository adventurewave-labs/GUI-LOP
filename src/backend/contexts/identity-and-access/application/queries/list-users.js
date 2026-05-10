import { ValidationError } from '../../../../shared-kernel/domain/errors.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * ListUsers query — paginated, returns user profile summaries.
 *
 * Repositories that support `list({ limit, offset })` are preferred; we
 * fall back to scanning a private `_byId` map (the in-memory repository
 * convention) for tests/dev when no `list` method is available.
 */
export class ListUsersQuery {
  constructor({ userRepository }) {
    this.userRepository = userRepository;
  }

  /**
   * @param {{ limit?: number, offset?: number }} [q]
   */
  async execute(q = {}) {
    const limit = q.limit ?? DEFAULT_LIMIT;
    const offset = q.offset ?? 0;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      throw new ValidationError(
        `limit must be 1..${MAX_LIMIT}`,
        'limit',
      );
    }
    if (!Number.isInteger(offset) || offset < 0) {
      throw new ValidationError('offset must be >= 0', 'offset');
    }

    let rows;
    if (typeof this.userRepository.list === 'function') {
      rows = await this.userRepository.list({ limit, offset });
    } else if (this.userRepository._byId instanceof Map) {
      // In-memory fallback ordered by createdAt desc (stable for tests).
      const all = [...this.userRepository._byId.values()].sort((a, b) => {
        const at = a.createdAt?.getTime?.() ?? 0;
        const bt = b.createdAt?.getTime?.() ?? 0;
        return bt - at;
      });
      rows = all.slice(offset, offset + limit);
    } else {
      rows = [];
    }

    return {
      users: rows.map((u) => ({
        id: u.id,
        email: u.email.value,
        username: u.username.value,
        role: u.role.value,
        fullName: u.fullName ?? null,
        isActive: u.isActive,
        createdAt: u.createdAt?.toISOString?.() ?? null,
        lastLogin: u.lastLogin?.toISOString?.() ?? null,
      })),
      pagination: {
        limit,
        offset,
        returned: rows.length,
      },
    };
  }
}
