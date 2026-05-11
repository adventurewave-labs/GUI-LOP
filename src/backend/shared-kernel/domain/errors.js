/**
 * Domain error hierarchy. All domain-layer errors derive from DomainError so
 * application/interface layers can map them to transport-specific responses.
 *
 * The base constructor accepts two call shapes for backwards compatibility:
 *   - canonical: `new DomainError(code, message, details?)`
 *   - legacy:    `new DomainError(message, code?)` — used by Phase 1/2 stubs.
 *
 * The legacy shape is detected by inspecting the second argument: if it
 * looks like a stable code (uppercase letters, digits, underscores only)
 * we treat the first arg as the message.
 */
const CODE_RE = /^[A-Z][A-Z0-9_]*$/;

function detectArgs(arg1, arg2, arg3) {
  // Canonical: (code, message, details?) where code matches CODE_RE.
  if (typeof arg1 === 'string' && CODE_RE.test(arg1) && typeof arg2 === 'string') {
    return { code: arg1, message: arg2, details: arg3 ?? {} };
  }
  // Legacy: (message, code?) — second arg is a code or absent.
  if (typeof arg2 === 'string' && CODE_RE.test(arg2)) {
    return { code: arg2, message: arg1 ?? '', details: {} };
  }
  // Single message form: (message)
  if (typeof arg1 === 'string') {
    return { code: 'DOMAIN_ERROR', message: arg1, details: arg3 ?? arg2 ?? {} };
  }
  return { code: 'DOMAIN_ERROR', message: '', details: {} };
}

export class DomainError extends Error {
  constructor(...args) {
    const { code, message, details } = detectArgs(...args);
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.details = details && typeof details === 'object' ? details : {};
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

/**
 * Raised when authentication is required but missing/invalid (HTTP 401).
 * Distinct from {@link ForbiddenError}, which represents an authenticated but
 * insufficiently-privileged actor.
 */
export class UnauthorisedError extends DomainError {
  constructor(message = 'Authentication required', details = {}) {
    super('UNAUTHORISED', message, details);
  }
}

/**
 * Raised when input fails domain validation. Accepts either an object of
 * structured `details` or a bare string field name (legacy callers from
 * Phase 1/2). When given a string the field is normalised onto `details.field`
 * AND copied to a top-level `field` property so the legacy HTTP error
 * mappers continue to work.
 */
export class ValidationError extends DomainError {
  constructor(message = 'Validation failed', detailsOrField = {}) {
    let details;
    let field;
    if (typeof detailsOrField === 'string') {
      field = detailsOrField;
      details = { field };
    } else {
      details = detailsOrField ?? {};
      field = details.field;
    }
    super('VALIDATION', message, details);
    if (field !== undefined) this.field = field;
  }
}

/** Raised when an aggregate invariant would be broken. */
export class InvariantViolationError extends DomainError {
  constructor(message = 'Invariant violated', details = {}) {
    super('INVARIANT_VIOLATION', message, details);
  }
}
