/**
 * @typedef {import('../../domain/session/session.js').Session} Session
 */

/**
 * SessionRepository — port for Session aggregate persistence.
 *
 * @typedef {Object} SessionRepository
 * @property {(id: string) => Promise<Session|null>} findById
 * @property {(refreshTokenHash: string) => Promise<Session|null>} findByRefreshTokenHash
 * @property {(session: Session, uow?: object) => Promise<void>} save
 * @property {(sessionId: string, now?: Date, uow?: object) => Promise<void>} revoke
 *   Convenience for revoking by id without loading the aggregate.
 */
export const SessionRepositorySymbol = Symbol.for('iam.SessionRepository');
