import { DomainError } from '../../../shared-kernel/domain/errors.js';
export class InvalidCredentialsError extends DomainError {
  constructor(message = 'Invalid credentials') {
    super(message, 'INVALID_CREDENTIALS');
  }
}

export class UserDeactivatedError extends DomainError {
  constructor(message = 'User account is deactivated') {
    super(message, 'USER_DEACTIVATED');
  }
}

export class SessionExpiredError extends DomainError {
  constructor(message = 'Session has expired') {
    super(message, 'SESSION_EXPIRED');
  }
}

export class SessionRevokedError extends DomainError {
  constructor(message = 'Session has been revoked') {
    super(message, 'SESSION_REVOKED');
  }
}

/**
 * A refresh token that was already rotated away was presented again. Per the
 * OAuth 2.0 Security BCP (RFC 9700 §4.14.2) that means it leaked (or the
 * client is buggy): the whole session — every token descended from it — is
 * revoked.
 */
export class RefreshTokenReusedError extends DomainError {
  constructor(message = 'Refresh token reuse detected; session revoked') {
    super(message, 'REFRESH_TOKEN_REUSED');
  }
}

/** Another request rotated this session's refresh token concurrently. */
export class RefreshConflictError extends DomainError {
  constructor(message = 'Session was refreshed concurrently; retry with the latest token') {
    super(message, 'REFRESH_CONFLICT');
  }
}
