import { ValidationError } from '../../../../shared-kernel/domain/errors.js';
export const WorkflowStatus = Object.freeze({
  CREATED: 'created',
  RUNNING: 'running',
  WAITING_FOR_HUMAN: 'waiting_for_human',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
});

const STATUS_VALUES = Object.freeze(Object.values(WorkflowStatus));

export const TERMINAL_STATUSES = Object.freeze([
  WorkflowStatus.COMPLETED,
  WorkflowStatus.FAILED,
  WorkflowStatus.CANCELLED,
]);

const WORKFLOW_TRANSITIONS = Object.freeze({
  created: new Set(['running', 'cancelled', 'failed']),
  running: new Set(['waiting_for_human', 'completed', 'failed', 'cancelled']),
  waiting_for_human: new Set(['running', 'failed', 'cancelled']),
  completed: new Set(),
  failed: new Set(),
  cancelled: new Set(),
});

const STEP_TRANSITIONS = Object.freeze({
  created: new Set(['running', 'failed', 'cancelled']),
  running: new Set(['waiting_for_human', 'completed', 'failed', 'cancelled']),
  waiting_for_human: new Set(['running', 'completed', 'failed', 'cancelled']),
  completed: new Set(),
  failed: new Set(),
  cancelled: new Set(),
});

export function canTransition(from, to) {
  if (!STATUS_VALUES.includes(from) || !STATUS_VALUES.includes(to)) return false;
  return WORKFLOW_TRANSITIONS[from].has(to);
}

export function canStepTransition(from, to) {
  if (!STATUS_VALUES.includes(from) || !STATUS_VALUES.includes(to)) return false;
  return STEP_TRANSITIONS[from].has(to);
}

export function isTerminal(s) {
  return TERMINAL_STATUSES.includes(s);
}

export function ensureStatus(s) {
  if (!STATUS_VALUES.includes(s)) {
    throw new ValidationError(`Invalid status: ${s}`, 'status');
  }
  return s;
}
