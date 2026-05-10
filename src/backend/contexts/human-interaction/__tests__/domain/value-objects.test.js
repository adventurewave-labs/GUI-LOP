import { ResponseAction, DEFAULT_ACTIONS } from '../../domain/human-response/response-action.js';
import { ResponsePayload } from '../../domain/human-response/response-payload.js';
import { ResponseRationale, MAX_LENGTH } from '../../domain/human-response/response-rationale.js';
import { ConfidenceScore } from '../../domain/human-response/confidence-score.js';
import { EligibilityRule } from '../../domain/pending-step/eligibility-rule.js';
import { TimeoutPolicy } from '../../domain/pending-step/timeout-policy.js';
import { InvalidResponseError, InvariantViolationError } from '../../domain/errors.js';

describe('ResponseAction', () => {
  it('accepts each default action and lowercases input', () => {
    for (const a of DEFAULT_ACTIONS) {
      const action = ResponseAction.of(a.toUpperCase());
      expect(action.value).toBe(a);
    }
  });

  it('accepts a template-defined extension', () => {
    const action = ResponseAction.of('delegate', ['delegate']);
    expect(action.value).toBe('delegate');
  });

  it('rejects unknown actions', () => {
    expect(() => ResponseAction.of('mystery')).toThrow(InvalidResponseError);
  });

  it('rejects empty input', () => {
    expect(() => ResponseAction.of('   ')).toThrow(InvalidResponseError);
  });
});

describe('ResponsePayload', () => {
  it('wraps an object and exposes a frozen value', () => {
    const p = ResponsePayload.of({ a: 1 });
    expect(p.value.a).toBe(1);
    expect(Object.isFrozen(p.value)).toBe(true);
  });

  it('rejects arrays and primitives', () => {
    expect(() => ResponsePayload.of([])).toThrow(InvalidResponseError);
    expect(() => ResponsePayload.of('x')).toThrow(InvalidResponseError);
    expect(() => ResponsePayload.of(null)).toThrow(InvalidResponseError);
  });
});

describe('ResponseRationale', () => {
  it('accepts up to MAX_LENGTH characters', () => {
    const r = ResponseRationale.of('x'.repeat(MAX_LENGTH));
    expect(r.value.length).toBe(MAX_LENGTH);
  });
  it('rejects strings longer than MAX_LENGTH', () => {
    expect(() => ResponseRationale.of('x'.repeat(MAX_LENGTH + 1))).toThrow(InvalidResponseError);
  });
  it('returns null for null/undefined', () => {
    expect(ResponseRationale.of(null)).toBeNull();
    expect(ResponseRationale.of(undefined)).toBeNull();
  });
});

describe('ConfidenceScore', () => {
  it('accepts values in [0, 1]', () => {
    expect(ConfidenceScore.of(0).value).toBe(0);
    expect(ConfidenceScore.of(1).value).toBe(1);
    expect(ConfidenceScore.of(0.42).value).toBe(0.42);
  });
  it('rejects out-of-range and non-numeric values', () => {
    expect(() => ConfidenceScore.of(-0.01)).toThrow(InvalidResponseError);
    expect(() => ConfidenceScore.of(1.01)).toThrow(InvalidResponseError);
    expect(() => ConfidenceScore.of(NaN)).toThrow(InvalidResponseError);
    expect(() => ConfidenceScore.of('high')).toThrow(InvalidResponseError);
  });
});

describe('EligibilityRule', () => {
  it('accepts no constraints', () => {
    const r = EligibilityRule.of({});
    expect(r.requiredRole).toBeNull();
    expect(r.requiredPermissions).toEqual([]);
    expect(r.scope).toBeNull();
  });
  it('rejects malformed inputs', () => {
    expect(() => EligibilityRule.of({ requiredRole: '' })).toThrow(InvariantViolationError);
    expect(() => EligibilityRule.of({ requiredPermissions: 'not-array' })).toThrow(InvariantViolationError);
    expect(() => EligibilityRule.of({ requiredPermissions: [''] })).toThrow(InvariantViolationError);
  });
});

describe('TimeoutPolicy', () => {
  it('accepts allowed values', () => {
    for (const v of ['fail', 'escalate', 'auto_approve']) {
      expect(TimeoutPolicy.of(v).value).toBe(v);
    }
  });
  it('rejects unknown values', () => {
    expect(() => TimeoutPolicy.of('retry')).toThrow(InvariantViolationError);
  });
});
