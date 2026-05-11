/**
 * AI ACL domain error taxonomy (ADR 0023).
 *
 * Every vendor adapter translates HTTP / SDK failures into one of these
 * classes. Domain and application code only ever sees these errors, never
 * vendor-specific shapes.
 */
import { DomainError } from '../../../../shared-kernel/domain/errors.js';

/** Network / 5xx / authentication failures — the provider is not usable. */
export class AIProviderUnavailable extends DomainError {
  constructor(message = 'AI provider is unavailable', details = {}) {
    super('AI_PROVIDER_UNAVAILABLE', message, details);
  }
}

/** 429 / quota / rate-limit responses — back off and retry later. */
export class AIQuotaExceeded extends DomainError {
  constructor(message = 'AI provider quota exceeded', details = {}) {
    super('AI_QUOTA_EXCEEDED', message, details);
  }
}

/** Vendor rejected the request shape (e.g. 400, bad parameters). */
export class AIInvalidRequest extends DomainError {
  constructor(message = 'AI provider rejected the request', details = {}) {
    super('AI_INVALID_REQUEST', message, details);
  }
}

/** Vendor returned a body that failed our schema/validation guard. */
export class AIBadResponse extends DomainError {
  constructor(message = 'AI provider returned a malformed response', details = {}) {
    super('AI_BAD_RESPONSE', message, details);
  }
}
