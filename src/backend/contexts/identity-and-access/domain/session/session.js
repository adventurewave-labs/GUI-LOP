import { ValidationError } from '../../shared-kernel-stubs.js';
import { SessionExpiredError, SessionRevokedError } from '../errors.js';
import {
  SessionCreated,
  SessionRefreshed,
  SessionRevoked,
} from '../events.js';

/**
 * Session aggregate root.
 *
 * Invariants:
 * - Cannot be used after `expiresAt`.
 * - `revoke()` is irreversible (a revoked session never returns).
 * - Each refresh exchanges the refresh-token hash atomically.
 */
export class Session {
  /**
   * @param {{
   *   id: string,
   *   userId: string,
   *   refreshTokenHash: string,
   *   ip?: string|null,
   *   userAgent?: string|null,
   *   createdAt?: Date,
   *   expiresAt: Date,
   *   lastSeenAt?: Date|null,
   *   isActive?: boolean,
   *   metadata?: object,
   *   version?: number,
   * }} props
   */
  constructor(props) {
    if (!props.id) throw new ValidationError('Session.id required', 'id');
    if (!props.userId)
      throw new ValidationError('Session.userId required', 'userId');
    if (!props.refreshTokenHash)
      throw new ValidationError(
        'Session.refreshTokenHash required',
        'refreshTokenHash',
      );
    if (!(props.expiresAt instanceof Date))
      throw new ValidationError('Session.expiresAt must be Date', 'expiresAt');

    this.id = props.id;
    this.userId = props.userId;
    this.refreshTokenHash = props.refreshTokenHash;
    this.ip = props.ip ?? null;
    this.userAgent = props.userAgent ?? null;
    this.createdAt = props.createdAt ?? new Date();
    this.expiresAt = props.expiresAt;
    this.lastSeenAt = props.lastSeenAt ?? this.createdAt;
    this.isActive = props.isActive ?? true;
    this.metadata = props.metadata ? { ...props.metadata } : {};
    this.version = props.version ?? 0;

    /** @private */
    this._events = [];
  }

  /**
   * Issue a brand-new session and emit `session.created`.
   * @param {{
   *   id: string,
   *   userId: string,
   *   refreshTokenHash: string,
   *   ip?: string|null,
   *   userAgent?: string|null,
   *   ttlMs: number,
   *   now?: Date,
   * }} args
   */
  static issue({ id, userId, refreshTokenHash, ip, userAgent, ttlMs, now }) {
    if (typeof ttlMs !== 'number' || ttlMs <= 0) {
      throw new ValidationError('ttlMs must be a positive number', 'ttlMs');
    }
    const ts = now ?? new Date();
    const expiresAt = new Date(ts.getTime() + ttlMs);
    const s = new Session({
      id,
      userId,
      refreshTokenHash,
      ip,
      userAgent,
      createdAt: ts,
      expiresAt,
      lastSeenAt: ts,
      isActive: true,
      version: 0,
    });
    s._enqueue(
      new SessionCreated({
        sessionId: s.id,
        userId: s.userId,
        ip: s.ip,
        occurredAt: ts,
      }),
    );
    return s;
  }

  /**
   * Rotate the refresh-token hash and bump expiry (sliding TTL).
   * @param {string} newHash
   * @param {Date} now
   * @param {number} [ttlMs] If provided, slide expiry by this much.
   */
  refresh(newHash, now, ttlMs) {
    this._assertUsable(now);
    if (!newHash || typeof newHash !== 'string') {
      throw new ValidationError('newHash required', 'refreshTokenHash');
    }
    this.refreshTokenHash = newHash;
    this.lastSeenAt = now;
    if (typeof ttlMs === 'number' && ttlMs > 0) {
      this.expiresAt = new Date(now.getTime() + ttlMs);
    }
    this.version += 1;
    this._enqueue(
      new SessionRefreshed({
        sessionId: this.id,
        userId: this.userId,
        occurredAt: now,
      }),
    );
  }

  /** Mark the session inactive forever. Idempotent. */
  revoke(now) {
    if (!this.isActive) return; // idempotent
    this.isActive = false;
    this.lastSeenAt = now ?? new Date();
    this.version += 1;
    this._enqueue(
      new SessionRevoked({
        sessionId: this.id,
        userId: this.userId,
        occurredAt: this.lastSeenAt,
      }),
    );
  }

  /** Update last-seen timestamp without emitting an event. */
  markSeen(now) {
    this._assertUsable(now);
    this.lastSeenAt = now;
  }

  /** True iff the session can still be used right now. */
  isUsable(now = new Date()) {
    return this.isActive && this.expiresAt.getTime() > now.getTime();
  }

  pullEvents() {
    const ev = this._events;
    this._events = [];
    return ev;
  }

  /** @private */
  _enqueue(event) {
    this._events.push(event);
  }

  /** @private */
  _assertUsable(now) {
    if (!this.isActive) {
      throw new SessionRevokedError();
    }
    if (this.expiresAt.getTime() <= (now ?? new Date()).getTime()) {
      throw new SessionExpiredError();
    }
  }
}
