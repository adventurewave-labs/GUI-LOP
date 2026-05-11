import { canStepTransition, canTransition, isTerminal, WorkflowStatus } from '../../domain/workflow/workflow-status.js';

describe('WorkflowStatus FSM', () => {
  describe('workflow-level transitions', () => {
    test.each([
      ['created', 'running', true],
      ['created', 'cancelled', true],
      ['created', 'failed', true],
      ['created', 'completed', false],
      ['running', 'waiting_for_human', true],
      ['running', 'completed', true],
      ['running', 'failed', true],
      ['running', 'cancelled', true],
      ['running', 'created', false],
      ['waiting_for_human', 'running', true],
      ['waiting_for_human', 'failed', true],
      ['waiting_for_human', 'cancelled', true],
      ['waiting_for_human', 'completed', false],
      ['completed', 'running', false],
      ['failed', 'running', false],
      ['cancelled', 'running', false],
      ['unknown', 'running', false],
      ['created', 'wat', false],
    ])('canTransition(%s -> %s) === %s', (from, to, expected) => {
      expect(canTransition(from, to)).toBe(expected);
    });
  });

  describe('step-level transitions', () => {
    test.each([
      ['created', 'running', true],
      ['running', 'completed', true],
      ['running', 'waiting_for_human', true],
      ['waiting_for_human', 'running', true],
      ['waiting_for_human', 'completed', true],
      ['completed', 'running', false],
    ])('step canTransition(%s -> %s) === %s', (from, to, expected) => {
      expect(canStepTransition(from, to)).toBe(expected);
    });
  });

  it('isTerminal recognises terminal statuses', () => {
    expect(isTerminal(WorkflowStatus.COMPLETED)).toBe(true);
    expect(isTerminal(WorkflowStatus.FAILED)).toBe(true);
    expect(isTerminal(WorkflowStatus.CANCELLED)).toBe(true);
    expect(isTerminal(WorkflowStatus.RUNNING)).toBe(false);
    expect(isTerminal(WorkflowStatus.CREATED)).toBe(false);
  });
});
