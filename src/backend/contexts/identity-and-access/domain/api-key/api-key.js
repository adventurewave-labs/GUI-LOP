import { ConflictError, ValidationError } from '../../../../shared-kernel/domain/errors.js';
import { Permission } from '../../domain/permission/permission.js';
import { ApiKeyId } from './api-key-id.js';
import { ApiKeySecret } from './api-key-secret.js';
import {
  ApiKeyMinted,
  ApiKeyRevoked,
  ApiKeyUsed,
} from '../events.js';

/**
 * ApiKey aggregate root.
 *
 * Invariants:
 *   - Plaintext is returned by `mint()` exactly once and is NEVER stored;
 *     only the SHA-256 hex digest persists in `keyHash`.
 *   - A revoked key cannot authenticate, ever (irreversible).
 *   - An expired key is silently ignored by `isUsable(now)`.
 *
 * The aggregate emits `api_key.minted`, `api_key.revoked`, `api_key.used`.
 */
export class ApiKey {
  /**
   * @param {{
   *   id: ApiKeyId,
   *   userId: string,
   *   name: string,
   *   keyHash: string,
   *   permissions?: Permission[],
   *   createdAt?: Date,
   *   expiresAt?: Date|null,
   *   revokedAt?: Date|null,
   *   lastUsedAt?: Date|null,
   *   isActive?: boolean,
   * }} props
   */
  constructor(props) {
    if (!(props.id instanceof ApiKeyId)) {
      throw new ValidationError('ApiKey.id must be ApiKeyId', 'id');
    }
    if (!props.userId || typeof props.userId !== 'string') {
      throw new ValidationError('ApiKey.userId required', 'userId');
    }
    if (typeof props.name !== 'string' || props.name.trim().length === 0) {
      throw new ValidationError('ApiKey.name required', 'name');
    }
    if (props.name.length > 255) {
      throw new ValidationError('ApiKey.name too long (>255)', 'name');
    }
    if (typeof props.keyHash !== 'string' || props.keyHash.length === 0) {
      throw new ValidationError('ApiKey.keyHash required', 'keyHash');
    }
    if (props.expiresAt != null && !(props.expiresAt instanceof Date)) {
      throw new ValidationError('expiresAt must be a Date', 'expiresAt');
    }

    const perms = props.permissions ?? [];
    for (const p of perms) {
      if (!(p instanceof Permission)) {
        throw new ValidationError(
          'ApiKey.permissions entries must be Permission VOs',
          'permissions',
        );
      }
    }

    this.id = props.id;
    this.userId = props.userId;
    this.name = props.name.trim();
    this.keyHash = props.keyHash;
    this.permissions = perms.slice();
    this.createdAt = props.createdAt ?? new Date();
    this.expiresAt = props.expiresAt ?? null;
    this.revokedAt = props.revokedAt ?? null;
    this.lastUsedAt = props.lastUsedAt ?? null;
    this.isActive = props.isActive ?? this.revokedAt == null;

    /** @private */
    this._events = [];
  }

  /**
   * Mint a fresh API key. Returns the aggregate AND the plaintext secret;
   * the plaintext is the one chance the caller has to read it.
   *
   * @param {{
   *   user: { id: string, isActive: boolean },
   *   name: string,
   *   permissions?: (string|Permission)[],
   *   expiresAt?: Date|null,
   *   idGen: { newId: () => string, randomBytes?: (n: number) => Buffer },
   *   clock: { now: () => Date },
   *   actor?: { type: string, id?: string },
   * }} args
   * @returns {{ aggregate: ApiKey, plaintextKey: string }}
   */
  static mint({ user, name, permissions, expiresAt, idGen, clock, actor }) {
    if (!user || typeof user.id !== 'string') {
      throw new ValidationError('user with id required', 'user');
    }
    if (user.isActive === false) {
      throw new ConflictError('Cannot mint API keys for a deactivated user');
    }
    if (!idGen || typeof idGen.newId !== 'function') {
      throw new ValidationError('idGen with newId() required', 'idGen');
    }
    if (!clock || typeof clock.now !== 'function') {
      throw new ValidationError('clock with now() required', 'clock');
    }
    const now = clock.now();
    if (expiresAt != null) {
      if (!(expiresAt instanceof Date)) {
        throw new ValidationError('expiresAt must be a Date', 'expiresAt');
      }
      if (expiresAt.getTime() <= now.getTime()) {
        throw new ValidationError('expiresAt must be in the future', 'expiresAt');
      }
    }

    const perms = (permissions ?? []).map((p) =>
      p instanceof Permission ? p : new Permission(p),
    );

    const id = ApiKeyId.generate(idGen);
    const secret = ApiKeySecret.generate(idGen);

    const aggregate = new ApiKey({
      id,
      userId: user.id,
      name,
      keyHash: secret.hash(),
      permissions: perms,
      createdAt: now,
      expiresAt: expiresAt ?? null,
      revokedAt: null,
      lastUsedAt: null,
      isActive: true,
    });

    aggregate._enqueue(
      new ApiKeyMinted({
        apiKeyId: id.value,
        userId: user.id,
        name: aggregate.name,
        permissions: perms.map((p) => p.value),
        expiresAt: expiresAt ?? null,
        occurredAt: now,
        actor: actor ?? { type: 'user', id: user.id },
      }),
    );

    return { aggregate, plaintextKey: secret.value };
  }

  /**
   * Mark the key revoked. Idempotent — calling again is a no-op.
   * @param {Date} [now]
   * @param {{ type: string, id?: string }} [actor]
   */
  revoke(now, actor) {
    if (!this.isActive) return; // idempotent
    const ts = now ?? new Date();
    this.isActive = false;
    this.revokedAt = ts;
    this._enqueue(
      new ApiKeyRevoked({
        apiKeyId: this.id.value,
        userId: this.userId,
        occurredAt: ts,
        actor,
      }),
    );
  }

  /**
   * Record that the key was used to authenticate. Emits a low-cardinality
   * usage event and updates `lastUsedAt`. Throws if the key is unusable.
   * @param {Date} now
   * @param {{ type: string, id?: string }} [actor]
   */
  recordUsage(now, actor) {
    if (!this.isUsable(now)) {
      throw new ConflictError('API key is not usable');
    }
    this.lastUsedAt = now;
    this._enqueue(
      new ApiKeyUsed({
        apiKeyId: this.id.value,
        userId: this.userId,
        occurredAt: now,
        actor: actor ?? { type: 'api-key', id: this.id.value },
      }),
    );
  }

  /** True iff the key can authenticate at `now`. */
  isUsable(now = new Date()) {
    if (!this.isActive) return false;
    if (this.revokedAt) return false;
    if (this.expiresAt && this.expiresAt.getTime() <= now.getTime()) {
      return false;
    }
    return true;
  }

  /** Drain pending events. */
  pullEvents() {
    const ev = this._events;
    this._events = [];
    return ev;
  }

  /** @private */
  _enqueue(event) {
    this._events.push(event);
  }
}
