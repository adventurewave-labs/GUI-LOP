/**
 * UserDirectoryReader port — read-only access to user attributes used for
 * eligibility computation (role, permissions, scopes).
 */
/* eslint-disable no-unused-vars */
export class UserDirectoryReader {
  /**
   * @param {string} userId
   * @returns {Promise<{ id: string, role: string, permissions: string[], scopes: string[] }|null>}
   */
  async getUser(userId) { throw new Error('not implemented'); }
}
