import { RegExpParser, visitRegExpAST } from '@eslint-community/regexpp';
import { ValidationError } from '../../../shared-kernel/domain/errors.js';

const regexParser = new RegExpParser({ ecmaVersion: 2025 });
export const RULE_TYPES = Object.freeze({
  REQUIRED: 'required',
  MIN_LENGTH: 'minLength',
  MAX_LENGTH: 'maxLength',
  PATTERN: 'pattern',
  MIN: 'min',
  MAX: 'max',
  ENUM: 'enum'
});

const ALL = new Set(Object.values(RULE_TYPES));

export class ValidationRule {
  constructor({ id, type, value, message }) {
    if (!id) throw new ValidationError('ValidationRule.id is required');
    if (!ALL.has(type)) throw new ValidationError(`Unknown validation rule: ${type}`);
    checkValue(type, value ?? null);
    if (message != null && typeof message !== 'string') {
      throw new ValidationError('ValidationRule.message must be a string');
    }
    this.id = id;
    this.type = type;
    this.value = value ?? null;
    this.message = message ?? null;
    Object.freeze(this);
  }

  /** @param {{ id: string, type: string, value?: unknown, message?: string|null }} spec */
  static of(spec) {
    return new ValidationRule(spec);
  }

  toJSON() {
    return { id: this.id, type: this.type, value: this.value, message: this.message };
  }
}

/** Longest `pattern` accepted; bounds the regex the client compiles. */
export const MAX_PATTERN_LENGTH = 512;

/**
 * Rule values arrive from AI drafts and are shipped to the browser, which
 * compiles `pattern` into a RegExp and compares numbers. They were never
 * checked: `{ type: 'minLength', value: 'abc' }` or an uncompilable pattern
 * passed the domain and failed (or misbehaved) client-side.
 */
function checkValue(type, value) {
  const fail = (why) => {
    throw new ValidationError(`ValidationRule(${type}).value ${why}`);
  };
  switch (type) {
    case RULE_TYPES.REQUIRED:
      if (value !== null && typeof value !== 'boolean') fail('must be boolean or absent');
      return;
    case RULE_TYPES.MIN_LENGTH:
    case RULE_TYPES.MAX_LENGTH:
      if (!Number.isInteger(value) || value < 0) fail('must be a non-negative integer');
      return;
    case RULE_TYPES.MIN:
    case RULE_TYPES.MAX:
      if (typeof value !== 'number' || !Number.isFinite(value)) fail('must be a finite number');
      return;
    case RULE_TYPES.PATTERN:
      if (typeof value !== 'string' || value.length === 0) fail('must be a non-empty string');
      if (value.length > MAX_PATTERN_LENGTH) fail(`must be at most ${MAX_PATTERN_LENGTH} characters`);
      checkPattern(value, fail);
      return;
    case RULE_TYPES.ENUM:
      if (!Array.isArray(value) || value.length === 0) fail('must be a non-empty array');
      if (!value.every((v) => ['string', 'number', 'boolean'].includes(typeof v))) {
        fail('entries must be strings, numbers or booleans');
      }
      return;
    default:
      return;
  }
}

/**
 * Validate an AI-supplied pattern by *parsing* it (never constructing a
 * RegExp from untrusted input on the server — CodeQL js/regex-injection), and
 * reject the classic catastrophic-backtracking shape: a repeating quantifier
 * nested inside another repeating quantifier where either is unbounded
 * (`(a+)+`, `(\w*)*`, `(x|y+){2,}`). The browser executes this pattern against
 * user keystrokes, so an exponential pattern would freeze the form.
 */
function checkPattern(src, fail) {
  let ast;
  try {
    ast = regexParser.parsePattern(src, 0, src.length, { unicode: false, unicodeSets: false });
  } catch {
    fail('must be a valid regular expression');
  }
  /** @type {{ unbounded: boolean }[]} */
  const stack = [];
  let nested = false;
  visitRegExpAST(ast, {
    onQuantifierEnter(q) {
      if (q.max <= 1) return; // `?` / `{0,1}` cannot repeat
      const unbounded = q.max === Infinity;
      if (stack.length > 0 && (unbounded || stack.some((s) => s.unbounded))) nested = true;
      stack.push({ unbounded });
    },
    onQuantifierLeave(q) {
      if (q.max > 1) stack.pop();
    },
  });
  if (nested) fail('must not nest repeating quantifiers (catastrophic backtracking)');
}
