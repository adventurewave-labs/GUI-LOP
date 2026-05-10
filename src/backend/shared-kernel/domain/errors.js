/**
 * Domain error hierarchy.
 * Stub of Phase 0 shared kernel; matches the canonical signature.
 */
export class DomainError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.details = details;
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

export class NotFoundError extends DomainError {
  constructor(message = 'Resource not found', details = {}) {
    super('NOT_FOUND', message, details);
  }
}

export class ConflictError extends DomainError {
  constructor(message = 'Conflict with current state', details = {}) {
    super('CONFLICT', message, details);
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = 'Action not permitted', details = {}) {
    super('FORBIDDEN', message, details);
  }
}

export class ValidationError extends DomainError {
  constructor(message = 'Validation failed', details = {}) {
    super('VALIDATION', message, details);
  }
}

export class InvariantViolationError extends DomainError {
  constructor(message = 'Invariant violated', details = {}) {
    super('INVARIANT_VIOLATION', message, details);
  }
}
