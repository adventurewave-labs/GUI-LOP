/**
 * Shared error types for the supporting contexts.
 */

export class DomainError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.details = details;
  }
}

export class ValidationError extends DomainError {
  constructor(message, details = {}) {
    super('VALIDATION_ERROR', message, details);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends DomainError {
  constructor(message, details = {}) {
    super('NOT_FOUND', message, details);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends DomainError {
  constructor(message, details = {}) {
    super('CONFLICT', message, details);
    this.name = 'ConflictError';
  }
}

export class InfrastructureError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'InfrastructureError';
    this.cause = cause;
  }
}
