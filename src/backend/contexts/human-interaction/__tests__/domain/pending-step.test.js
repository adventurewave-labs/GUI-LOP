import { PendingStep } from '../../domain/pending-step/pending-step.js';
import { EligibilityRule } from '../../domain/pending-step/eligibility-rule.js';
import { InvariantViolationError } from '../../domain/errors.js';
import { HUMAN_STEP_ESCALATED } from '../../domain/events.js';

describe('PendingStep aggregate', () => {
  const opened = () => PendingStep.open({
    workflowId: 'wf-1',
    stepId: 'step-1',
    eligibility: { requiredRole: 'reviewer', requiredPermissions: ['workflow:respond'] },
    deadline: new Date('2026-05-10T11:00:00Z'),
    onTimeout: 'escalate',
    now: new Date('2026-05-10T10:00:00Z'),
  });

  it('opens with sane defaults', () => {
    const step = opened();
    expect(step.escalationLevel).toBe(0);
    expect(step.isClosed()).toBe(false);
    expect(step.eligibility.requiredRole).toBe('reviewer');
    expect(step.onTimeout.value).toBe('escalate');
  });

  it('escalation_level is monotonic — must strictly increase', () => {
    const step = opened();
    const now = new Date('2026-05-10T11:01:00Z');
    step.escalate(now, 1, { eligibility: EligibilityRule.of({}) });
    expect(step.escalationLevel).toBe(1);
    expect(() => step.escalate(now, 1)).toThrow(InvariantViolationError);
    expect(() => step.escalate(now, 0)).toThrow(InvariantViolationError);
    step.escalate(new Date('2026-05-10T11:05:00Z'), 2);
    expect(step.escalationLevel).toBe(2);
  });

  it('escalation emits human_step.escalated', () => {
    const step = opened();
    step.escalate(new Date('2026-05-10T11:01:00Z'), 1);
    const events = step.pendingEvents();
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe(HUMAN_STEP_ESCALATED);
    expect(events[0].payload.level).toBe(1);
  });

  it('closed steps cannot be reopened or re-closed', () => {
    const step = opened();
    step.close(new Date('2026-05-10T12:00:00Z'));
    expect(step.isClosed()).toBe(true);
    expect(() => step.close(new Date('2026-05-10T12:01:00Z'))).toThrow(InvariantViolationError);
    expect(() => step.escalate(new Date('2026-05-10T12:02:00Z'), 1)).toThrow(InvariantViolationError);
  });

  it('isOverdue tracks deadline against the current time', () => {
    const step = opened();
    expect(step.isOverdue(new Date('2026-05-10T10:30:00Z'))).toBe(false);
    expect(step.isOverdue(new Date('2026-05-10T11:00:00Z'))).toBe(true);
    expect(step.isOverdue(new Date('2026-05-10T12:00:00Z'))).toBe(true);
    step.close(new Date('2026-05-10T13:00:00Z'));
    expect(step.isOverdue(new Date('2026-05-10T14:00:00Z'))).toBe(false);
  });

  it('rehydrate + toState round trip', () => {
    const step = opened();
    step.escalate(new Date('2026-05-10T11:01:00Z'), 1);
    const state = step.toState();
    const round = PendingStep.rehydrate(state);
    expect(round.toState()).toEqual(state);
  });
});
