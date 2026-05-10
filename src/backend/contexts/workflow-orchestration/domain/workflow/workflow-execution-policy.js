import { WorkflowStatus } from './workflow-status.js';

/** EngineAction is a discriminated union returned by `nextAction()`. */
export const EngineActionType = Object.freeze({
  ADVANCE: 'AdvanceToNextStep',
  PAUSE_HUMAN: 'PauseForHumanInput',
  INVOKE_EXTERNAL: 'InvokeExternal',
  COMPLETE: 'Complete',
  FAIL: 'Fail',
  IDLE: 'Idle',
});

export const EngineAction = {
  advance(step) {
    return Object.freeze({ type: EngineActionType.ADVANCE, step });
  },
  pauseHuman(step) {
    return Object.freeze({ type: EngineActionType.PAUSE_HUMAN, step });
  },
  invokeExternal(step) {
    return Object.freeze({ type: EngineActionType.INVOKE_EXTERNAL, step });
  },
  complete() {
    return Object.freeze({ type: EngineActionType.COMPLETE });
  },
  fail(reason) {
    return Object.freeze({ type: EngineActionType.FAIL, reason });
  },
  idle(reason) {
    return Object.freeze({ type: EngineActionType.IDLE, reason });
  },
};

/**
 * WorkflowExecutionPolicy.nextAction — pure function over the workflow.
 * Decides what the engine should do next based purely on aggregate state.
 */
export function nextAction(workflow) {
  if (!workflow) return EngineAction.idle('no_workflow');
  const status = workflow.status;
  if (status === WorkflowStatus.COMPLETED
    || status === WorkflowStatus.FAILED
    || status === WorkflowStatus.CANCELLED) {
    return EngineAction.idle('terminal');
  }
  if (status === WorkflowStatus.CREATED) {
    return EngineAction.idle('not_started');
  }
  if (status === WorkflowStatus.WAITING_FOR_HUMAN) {
    return EngineAction.idle('waiting_for_human');
  }

  const steps = workflow.steps;
  const failed = steps.find((s) => s.isFailed());
  if (failed) return EngineAction.fail(failed.error ?? 'step_failed');

  const pending = steps.find((s) => !s.isTerminal() && !s.isWaitingForHuman());
  if (!pending) {
    const waiting = steps.find((s) => s.isWaitingForHuman());
    if (waiting) return EngineAction.pauseHuman(waiting);
    return EngineAction.complete();
  }
  switch (pending.kind) {
    case 'automated': return EngineAction.advance(pending);
    case 'external': return EngineAction.invokeExternal(pending);
    case 'human': return EngineAction.pauseHuman(pending);
    default: return EngineAction.fail(`unknown_step_kind:${pending.kind}`);
  }
}

export function isPause(action) {
  return action.type === EngineActionType.PAUSE_HUMAN
    || action.type === EngineActionType.INVOKE_EXTERNAL
    || action.type === EngineActionType.IDLE;
}

export function isTerminalAction(action) {
  return action.type === EngineActionType.COMPLETE
    || action.type === EngineActionType.FAIL;
}
