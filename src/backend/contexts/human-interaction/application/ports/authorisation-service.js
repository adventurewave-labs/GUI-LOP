/**
 * AuthorisationService port (Identity & Access).
 *
 * Mirrors the shape used by the Identity context: the use case asks
 * "may this actor perform this action on this scope?".
 */
/* eslint-disable no-unused-vars */
export class AuthorisationService {
  /**
   * @param {object} args
   * @param {object} args.actor       e.g. { userId, sessionId }
   * @param {string} args.permission  e.g. "workflow:respond"
   * @param {string} [args.scope]     e.g. workflow id
   * @returns {Promise<{authorised: boolean, reason?: string, user?: object}>}
   */
  async authorise(args) { throw new Error('not implemented'); }
}
