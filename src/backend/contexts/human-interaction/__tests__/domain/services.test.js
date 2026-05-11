import { EligibilityService } from '../../domain/services/eligibility-service.js';
import { EscalationPolicyService } from '../../domain/services/escalation-policy-service.js';
import { ResponseValidationService } from '../../domain/services/response-validation-service.js';
import { PendingStep } from '../../domain/pending-step/pending-step.js';
import { EligibilityRule } from '../../domain/pending-step/eligibility-rule.js';

const baseStep = () => PendingStep.open({
  workflowId: 'wf-1',
  stepId: 'step-1',
  eligibility: {
    requiredRole: 'reviewer',
    requiredPermissions: ['workflow:respond'],
    scope: 'wf-1',
  },
  onTimeout: 'escalate',
  now: new Date(),
});

describe('EligibilityService', () => {
  it('accepts a user matching role + permissions + scope', () => {
    const step = baseStep();
    const user = { id: 'u-1', role: 'reviewer', permissions: ['workflow:respond'], scopes: ['wf-1'] };
    expect(EligibilityService.eligibleFor(user, step, { id: 'wf-1' })).toBe(true);
  });

  it('rejects when role differs', () => {
    const step = baseStep();
    const user = { id: 'u-1', role: 'viewer', permissions: ['workflow:respond'], scopes: ['wf-1'] };
    expect(EligibilityService.eligibleFor(user, step, { id: 'wf-1' })).toBe(false);
  });

  it('rejects missing permissions', () => {
    const step = baseStep();
    const user = { id: 'u-1', role: 'reviewer', permissions: [], scopes: ['wf-1'] };
    expect(EligibilityService.eligibleFor(user, step, { id: 'wf-1' })).toBe(false);
  });

  it('rejects missing scope', () => {
    const step = baseStep();
    const user = { id: 'u-1', role: 'reviewer', permissions: ['workflow:respond'], scopes: ['other'] };
    expect(EligibilityService.eligibleFor(user, step, { id: 'wf-1' })).toBe(false);
  });

  it('rejects closed steps regardless of user', () => {
    const step = baseStep();
    step.close(new Date());
    const user = { id: 'u-1', role: 'reviewer', permissions: ['workflow:respond'], scopes: ['wf-1'] };
    expect(EligibilityService.eligibleFor(user, step, { id: 'wf-1' })).toBe(false);
  });
});

describe('EscalationPolicyService', () => {
  it('default ladder produces three escalations then exhaustion', () => {
    const svc = new EscalationPolicyService();
    const step = baseStep();
    const now = new Date();

    const l1 = svc.next(step, now);
    expect(l1.level).toBe(1);
    expect(l1.eligibility.requiredRole).toBeNull(); // dropped
    step.escalate(now, l1.level, { eligibility: l1.eligibility });

    const l2 = svc.next(step, now);
    expect(l2.level).toBe(2);
    expect(l2.eligibility.requiredPermissions).toEqual([]); // dropped
    step.escalate(now, l2.level, { eligibility: l2.eligibility });

    const l3 = svc.next(step, now);
    expect(l3.level).toBe(3);
    expect(l3.eligibility.scope).toBeNull(); // dropped
    step.escalate(now, l3.level, { eligibility: l3.eligibility });

    expect(svc.next(step, now)).toBeNull();
  });

  it('returns null for closed steps', () => {
    const svc = new EscalationPolicyService();
    const step = baseStep();
    step.close(new Date());
    expect(svc.next(step, new Date())).toBeNull();
  });

  it('honours a custom ladder', () => {
    const svc = new EscalationPolicyService({
      ladder: [
        () => EligibilityRule.of({ requiredRole: 'manager' }),
      ],
    });
    const step = baseStep();
    const result = svc.next(step, new Date());
    expect(result.level).toBe(1);
    expect(result.eligibility.requiredRole).toBe('manager');
  });
});

describe('ResponseValidationService', () => {
  it('accepts a valid action+payload pair', () => {
    const svc = ResponseValidationService.forStep({
      allowedActions: ['delegate'],
      responseSchema: {
        type: 'object',
        required: ['note'],
        properties: { note: { type: 'string' } },
        additionalProperties: false,
      },
    });
    const result = svc.validate('delegate', { note: 'pls' });
    expect(result.isOk()).toBe(true);
    const { action, payload } = result.unwrap();
    expect(action.value).toBe('delegate');
    expect(payload.toJSON()).toEqual({ note: 'pls' });
  });

  it('rejects unknown action', () => {
    const svc = ResponseValidationService.forStep({});
    const result = svc.validate('unknown', {});
    expect(result.isErr()).toBe(true);
  });

  it('rejects extra properties when additionalProperties:false', () => {
    const svc = ResponseValidationService.forStep({
      responseSchema: {
        type: 'object',
        properties: { a: { type: 'string' } },
        additionalProperties: false,
      },
    });
    const result = svc.validate('approve', { a: 'x', extra: 1 });
    expect(result.isErr()).toBe(true);
  });

  it('rejects type mismatches', () => {
    const svc = ResponseValidationService.forStep({
      responseSchema: {
        type: 'object',
        properties: { count: { type: 'number', minimum: 1 } },
      },
    });
    const result = svc.validate('approve', { count: 'not-a-number' });
    expect(result.isErr()).toBe(true);
  });

  it('enforces minimum on numbers', () => {
    const svc = ResponseValidationService.forStep({
      responseSchema: {
        type: 'object',
        properties: { count: { type: 'number', minimum: 1 } },
      },
    });
    expect(svc.validate('approve', { count: 0 }).isErr()).toBe(true);
    expect(svc.validate('approve', { count: 2 }).isOk()).toBe(true);
  });

  it('enforces enum values', () => {
    const svc = ResponseValidationService.forStep({
      responseSchema: {
        type: 'object',
        properties: { tier: { enum: ['gold', 'silver'] } },
      },
    });
    expect(svc.validate('approve', { tier: 'bronze' }).isErr()).toBe(true);
    expect(svc.validate('approve', { tier: 'gold' }).isOk()).toBe(true);
  });
});
