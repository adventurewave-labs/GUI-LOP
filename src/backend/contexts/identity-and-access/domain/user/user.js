import { ConflictError, ValidationError } from '../../shared-kernel-stubs.js';
import {
  UserDeactivatedError,
  InvalidCredentialsError,
} from '../errors.js';
import {
  UserRegistered,
  UserDeactivated,
  UserReactivated,
  UserEmailChanged,
  UserUsernameChanged,
  UserPasswordChanged,
} from '../events.js';
import { EmailAddress } from './email-address.js';
import { Username } from './username.js';
import { PasswordHash } from './password-hash.js';
import { RoleName } from './role-name.js';

/**
 * User aggregate root.
 * All mutating methods enforce invariants and append a domain event
 * to the internal queue. Use `pullEvents()` to drain the queue.
 */
export class User {
  /**
   * @param {{
   *   id: string,
   *   email: EmailAddress,
   *   username: Username,
   *   passwordHash: PasswordHash,
   *   role: RoleName,
   *   isActive?: boolean,
   *   fullName?: string|null,
   *   metadata?: object,
   *   createdAt?: Date,
   *   updatedAt?: Date,
   *   lastLogin?: Date|null,
   *   version?: number,
   * }} props
   */
  constructor(props) {
    if (!props.id || typeof props.id !== 'string') {
      throw new ValidationError('User.id required', 'id');
    }
    if (!(props.email instanceof EmailAddress)) {
      throw new ValidationError('User.email must be EmailAddress', 'email');
    }
    if (!(props.username instanceof Username)) {
      throw new ValidationError('User.username must be Username', 'username');
    }
    if (!(props.passwordHash instanceof PasswordHash)) {
      throw new ValidationError(
        'User.passwordHash must be a PasswordHash VO',
        'passwordHash',
      );
    }
    if (!(props.role instanceof RoleName)) {
      throw new ValidationError('User.role must be RoleName', 'role');
    }

    this.id = props.id;
    this.email = props.email;
    this.username = props.username;
    this.passwordHash = props.passwordHash;
    this.role = props.role;
    this.isActive = props.isActive ?? true;
    this.fullName = props.fullName ?? null;
    this.metadata = props.metadata ? { ...props.metadata } : {};
    this.createdAt = props.createdAt ?? new Date();
    this.updatedAt = props.updatedAt ?? this.createdAt;
    this.lastLogin = props.lastLogin ?? null;
    this.version = props.version ?? 0;

    /** @private */
    this._events = [];
  }

  /**
   * Factory: create a brand-new User and emit `user.registered`.
   * @param {{
   *   id: string,
   *   email: EmailAddress,
   *   username: Username,
   *   passwordHash: PasswordHash,
   *   role?: RoleName,
   *   fullName?: string|null,
   *   now?: Date,
   * }} args
   */
  static register({ id, email, username, passwordHash, role, fullName, now }) {
    const role_ = role ?? RoleName.user();
    const ts = now ?? new Date();
    const u = new User({
      id,
      email,
      username,
      passwordHash,
      role: role_,
      fullName: fullName ?? null,
      isActive: true,
      createdAt: ts,
      updatedAt: ts,
      version: 0,
    });
    u._enqueue(
      new UserRegistered({
        userId: u.id,
        email: u.email.value,
        username: u.username.value,
        role: u.role.value,
        occurredAt: ts,
      }),
    );
    return u;
  }

  /**
   * Verify credentials. Does NOT mutate state.
   * @param {string} plaintextPassword
   * @param {{ verify(plaintext: string, hash: PasswordHash): Promise<boolean>|boolean }} hasher
   * @returns {Promise<boolean>}
   */
  async authenticate(plaintextPassword, hasher) {
    if (!this.isActive) {
      throw new UserDeactivatedError();
    }
    const ok = await hasher.verify(plaintextPassword, this.passwordHash);
    if (!ok) {
      throw new InvalidCredentialsError();
    }
    return true;
  }

  /** @param {EmailAddress} newEmail @param {Date} [now] */
  changeEmail(newEmail, now) {
    if (!(newEmail instanceof EmailAddress)) {
      throw new ValidationError('newEmail must be EmailAddress', 'email');
    }
    if (newEmail.equals(this.email)) return;
    const old = this.email.value;
    this.email = newEmail;
    this._touch(now);
    this._enqueue(
      new UserEmailChanged({
        userId: this.id,
        oldEmail: old,
        newEmail: newEmail.value,
        occurredAt: this.updatedAt,
      }),
    );
  }

  /** @param {Username} newUsername @param {Date} [now] */
  changeUsername(newUsername, now) {
    if (!(newUsername instanceof Username)) {
      throw new ValidationError('newUsername must be Username', 'username');
    }
    if (newUsername.equals(this.username)) return;
    const old = this.username.value;
    this.username = newUsername;
    this._touch(now);
    this._enqueue(
      new UserUsernameChanged({
        userId: this.id,
        oldUsername: old,
        newUsername: newUsername.value,
        occurredAt: this.updatedAt,
      }),
    );
  }

  /** @param {PasswordHash} newHash @param {Date} [now] */
  changePassword(newHash, now) {
    if (!(newHash instanceof PasswordHash)) {
      throw new ValidationError('newHash must be PasswordHash', 'passwordHash');
    }
    if (newHash.equals(this.passwordHash)) return;
    this.passwordHash = newHash;
    this._touch(now);
    this._enqueue(
      new UserPasswordChanged({ userId: this.id, occurredAt: this.updatedAt }),
    );
  }

  /** @param {Date} [now] */
  deactivate(now) {
    if (!this.isActive) {
      throw new ConflictError('User is already deactivated');
    }
    this.isActive = false;
    this._touch(now);
    this._enqueue(
      new UserDeactivated({ userId: this.id, occurredAt: this.updatedAt }),
    );
  }

  /** @param {Date} [now] */
  reactivate(now) {
    if (this.isActive) {
      throw new ConflictError('User is already active');
    }
    this.isActive = true;
    this._touch(now);
    this._enqueue(
      new UserReactivated({ userId: this.id, occurredAt: this.updatedAt }),
    );
  }

  /** @param {Date} now */
  recordLogin(now) {
    this.lastLogin = now ?? new Date();
    // recordLogin does not bump version: it's an external observation.
    this.updatedAt = this.lastLogin;
  }

  /**
   * Drain pending events. Returns and clears the internal queue.
   */
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
  _touch(now) {
    this.updatedAt = now ?? new Date();
    this.version += 1;
  }
}
