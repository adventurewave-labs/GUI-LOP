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
