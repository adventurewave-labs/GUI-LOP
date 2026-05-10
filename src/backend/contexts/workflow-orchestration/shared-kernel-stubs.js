// TODO: replace with shared-kernel import after Phase 0 merge.
// Minimal local stand-ins for the shared kernel pieces that the
// Workflow Orchestration context depends on. When Phase 0 lands,
// swap these imports for `@shared-kernel/...` and delete this file.

/**
 * Result<T, E> — a tiny Either-style type.
 * @template T, E
 */
export class Result {
  /** @private */
  constructor(ok, value, error) {
    this._ok = ok;
    this._value = value;
    this._error = error;
    Object.freeze(this);
  }

  static ok(value) {
    return new Result(true, value, undefined);
  }

  static fail(error) {
    return new Result(false, undefined, error);
  }

  isOk() { return this._ok; }
  isFail() { return !this._ok; }

  get value() {
    if (!this._ok) throw new Error('Cannot read .value of a failed Result');
    return this._value;
  }
  get error() {
    if (this._ok) throw new Error('Cannot read .error of a successful Result');
    return this._error;
  }

  map(fn) { return this._ok ? Result.ok(fn(this._value)) : this; }
  unwrapOr(fallback) { return this._ok ? this._value : fallback; }
}

/** Base DomainEvent — superseded by shared-kernel version. */
export class DomainEvent {
  constructor(props) {
    this.eventId = props.eventId ?? cryptoRandomUuid();
    this.eventType = props.eventType;
    this.eventVersion = props.eventVersion ?? 1;
    this.aggregateId = props.aggregateId;
    this.aggregateType = props.aggregateType;
    this.occurredAt = props.occurredAt ?? new Date();
    this.payload = Object.freeze({ ...(props.payload ?? {}) });
    this.correlationId = props.correlationId;
    this.causationId = props.causationId;
    this.actor = props.actor ? Object.freeze({ ...props.actor }) : undefined;
    Object.freeze(this);
  }
}

function cryptoRandomUuid() {
  try {
    return globalThis.crypto?.randomUUID?.() ?? fallbackUuid();
  } catch {
    return fallbackUuid();
  }
}

function fallbackUuid() {
  const b = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0'));
  return `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h
    .slice(6, 8)
    .join('')}-${h.slice(8, 10).join('')}-${h.slice(10, 16).join('')}`;
}

/* ---------------- common error taxonomy ---------------- */

export class DomainError extends Error {
  constructor(message, code) {
    super(message);
    this.name = this.constructor.name;
    this.code = code ?? 'DOMAIN_ERROR';
  }
}

export class ValidationError extends DomainError {
  constructor(message, field) {
    super(message, 'VALIDATION');
    this.field = field;
  }
}

export class NotFoundError extends DomainError {
  constructor(message) { super(message, 'NOT_FOUND'); }
}

export class ConflictError extends DomainError {
  constructor(message) { super(message, 'CONFLICT'); }
}

export class ForbiddenError extends DomainError {
  constructor(message) { super(message, 'FORBIDDEN'); }
}

export class UnauthorisedError extends DomainError {
  constructor(message) { super(message, 'UNAUTHORISED'); }
}

/* ---------------- ports the context needs ---------------- */

export class SystemClock {
  now() { return new Date(); }
}

export class FixedClock {
  constructor(date) {
    this._date = date instanceof Date ? date : new Date(date);
  }
  now() { return new Date(this._date.getTime()); }
  advance(ms) { this._date = new Date(this._date.getTime() + ms); }
}

export class UuidIdGenerator {
  next() { return cryptoRandomUuid(); }
}

export class SequentialIdGenerator {
  constructor(prefix = 'id') {
    this._prefix = prefix;
    this._n = 0;
  }
  next() {
    this._n += 1;
    return `${this._prefix}-${this._n.toString().padStart(8, '0')}-0000-0000-0000-000000000000`;
  }
}
