/**
 * Domain error hierarchy. All domain-layer errors derive from DomainError so
 * application/interface layers can map them to transport-specific responses.
 */
export class DomainError extends Error {
  /**
   * @param {string} code  Stable machine-readable error code.
   * @param {string} message  Human-readable description.
   * @param {Record<string, unknown>} [details]  Structured context.
   */
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

/** Raised when a referenced entity does not exist. */
export class NotFoundError extends DomainError {
  constructor(message = 'Resource not found', details = {}) {
    super('NOT_FOUND', message, details);
  }
}

/** Raised when an operation conflicts with current state (e.g. version clash). */
export class ConflictError extends DomainError {
  constructor(message = 'Conflict with current state', details = {}) {
    super('CONFLICT', message, details);
  }
}

/** Raised when the actor lacks permission to perform the action. */
export class ForbiddenError extends DomainError {
  constructor(message = 'Action not permitted', details = {}) {
    super('FORBIDDEN', message, details);
  }
}

/** Raised when input fails domain validation. */
export class ValidationError extends DomainError {
  constructor(message = 'Validation failed', details = {}) {
    super('VALIDATION', message, details);
  }
}

/** Raised when an aggregate invariant would be broken. */
export class InvariantViolationError extends DomainError {
  constructor(message = 'Invariant violated', details = {}) {
    super('INVARIANT_VIOLATION', message, details);
  }
}
