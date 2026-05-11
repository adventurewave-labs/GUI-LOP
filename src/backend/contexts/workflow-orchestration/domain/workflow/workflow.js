import { ValidationError } from '../../../../shared-kernel/domain/errors.js';
import {
  WorkflowCancelled,
  WorkflowCompleted,
  WorkflowCreated,
  WorkflowFailed,
  WorkflowHumanInputRequired,
  WorkflowStarted,
  WorkflowStepCompleted,
  WorkflowStepFailed,
  WorkflowStepStarted,
} from '../events.js';
import {
  InvalidStateTransitionError,
  StepNotFoundError,
} from '../errors.js';
import { WorkflowContext } from './workflow-context.js';
import { WorkflowStep } from './workflow-step.js';
import { WorkflowTransition } from './workflow-transition.js';
import {
  canTransition,
  ensureStatus,
  isTerminal,
  WorkflowStatus,
} from './workflow-status.js';
import { nextAction } from './workflow-execution-policy.js';

/**
 * Workflow aggregate root.
 */
export class Workflow {
  /** @private */
  constructor(state) {
    this._id = state.id;
    this._templateKey = state.templateKey;
    this._templateVersion = state.templateVersion;
    this._context = state.context instanceof WorkflowContext
      ? state.context
      : WorkflowContext.of(state.context);
    this._status = ensureStatus(state.status ?? WorkflowStatus.CREATED);
    this._steps = state.steps.map(
      (s) => (s instanceof WorkflowStep ? s : new WorkflowStep(s)),
    );
    this._transitions = (state.transitions ?? []).map(
      (t) => (t instanceof WorkflowTransition ? t : new WorkflowTransition(t)),
    );
    this._createdBy = state.createdBy ?? null;
    this._createdAt = toDate(state.createdAt);
    this._startedAt = state.startedAt ? toDate(state.startedAt) : null;
    this._completedAt = state.completedAt ? toDate(state.completedAt) : null;
    this._failureReason = state.failureReason ?? null;
    this._cancellation = state.cancellation ?? null;
    this._version = state.version ?? 0;
    this._events = [];
  }

  get id() { return this._id; }
  get templateKey() { return this._templateKey; }
  get templateVersion() { return this._templateVersion; }
  get context() { return this._context; }
  get status() { return this._status; }
  get steps() { return [...this._steps]; }
  get transitions() { return [...this._transitions]; }
  get createdAt() { return this._createdAt; }
  get startedAt() { return this._startedAt; }
  get completedAt() { return this._completedAt; }
  get version() { return this._version; }
  get createdBy() { return this._createdBy; }
  get failureReason() { return this._failureReason; }
  get cancellation() { return this._cancellation; }

  static createFromTemplate(props) {
    if (!props.id) throw new ValidationError('Workflow id is required', 'id');
    if (!props.template) throw new ValidationError('template is required', 'template');
    if (!props.now) throw new ValidationError('now (clock) is required', 'now');
    const template = props.template;
    if (!template.steps || template.steps.length === 0) {
      throw new ValidationError(
        'Cannot create workflow from a template with no steps',
        'template.steps',
      );
    }
    const stepIdGen = props.stepIdGen ?? defaultStepIdGen(props.id);
    const steps = template.steps.map((def, idx) => new WorkflowStep({
      id: stepIdGen.next(),
      name: def.name,
      kind: def.kind,
      order: idx,
      status: WorkflowStatus.CREATED,
      uiSpec: def.uiSpec ?? null,
      deadline: def.deadline ?? null,
      onTimeout: def.onTimeout ?? 'fail',
    }));
    const wf = new Workflow({
      id: props.id,
      templateKey: template.key.value ?? template.key,
      templateVersion: template.version.value ?? template.version,
      context: WorkflowContext.of(props.context ?? {}),
      status: WorkflowStatus.CREATED,
      steps,
      transitions: [],
      createdBy: props.createdBy ?? null,
      createdAt: props.now,
      version: 0,
    });
    wf._events.push(new WorkflowCreated({
      workflowId: wf._id,
      templateKey: wf._templateKey,
      version: wf._templateVersion,
      context: wf._context.toJSON(),
      occurredAt: props.now,
      actor: props.actor,
      correlationId: props.correlationId,
    }));
    return wf;
  }

  static rehydrate(state) { return new Workflow(state); }

  start(now, ctx = {}) {
    if (this._status === WorkflowStatus.RUNNING) return [];
    if (!canTransition(this._status, WorkflowStatus.RUNNING)) {
      throw new InvalidStateTransitionError(this._status, WorkflowStatus.RUNNING);
    }
    this._transitionWorkflow(WorkflowStatus.RUNNING, now);
    this._startedAt = now;
    const ev = new WorkflowStarted({
      workflowId: this._id,
      startedAt: now,
      occurredAt: now,
      actor: ctx.actor,
      correlationId: ctx.correlationId,
    });
    this._events.push(ev);
    return [ev];
  }

  nextAction() { return nextAction(this); }

  beginStep(stepId, now, ctx = {}) {
    this._ensureRunning('beginStep');
    const step = this._findStep(stepId);
    if (step.isRunning() || step.isCompleted() || step.isFailed()) return [];
    step._start(now);
    const ev = new WorkflowStepStarted({
      workflowId: this._id,
      stepId: step.id,
      stepName: step.name,
      occurredAt: now,
      actor: ctx.actor,
      correlationId: ctx.correlationId,
    });
    this._events.push(ev);
    return [ev];
  }

  recordStepOutput(stepId, output, now, ctx = {}) {
    this._ensureRunning('recordStepOutput');
    const step = this._findStep(stepId);
    if (!step.isRunning()) {
      throw new InvalidStateTransitionError(step.status, WorkflowStatus.COMPLETED, `step:${step.name}`);
    }
    step._complete(output, now);
    if (output && typeof output === 'object') {
      this._context = this._context.merge({ [step.name]: output });
    }
    const events = [
      new WorkflowStepCompleted({
        workflowId: this._id,
        stepId: step.id,
        output,
        occurredAt: now,
        actor: ctx.actor,
        correlationId: ctx.correlationId,
      }),
    ];
    this._events.push(...events);
    if (this._steps.every((s) => s.isCompleted())) {
      events.push(...this._complete(now, ctx));
    }
    return events;
  }

  markStepWaitingForHuman(stepId, uiSpec, now, ctx = {}) {
    this._ensureRunning('markStepWaitingForHuman');
    const step = this._findStep(stepId);
    if (!step.isRunning() && !step.isCreated()) {
      throw new InvalidStateTransitionError(step.status, WorkflowStatus.WAITING_FOR_HUMAN, `step:${step.name}`);
    }
    if (step.isCreated()) step._start(now);
    step._markWaitingForHuman(uiSpec, now);
    this._transitionWorkflow(WorkflowStatus.WAITING_FOR_HUMAN, now);
    const ev = new WorkflowHumanInputRequired({
      workflowId: this._id,
      stepId: step.id,
      uiSpec: uiSpec ?? step.uiSpec,
      occurredAt: now,
      actor: ctx.actor,
      correlationId: ctx.correlationId,
    });
    this._events.push(ev);
    return [ev];
  }

  applyHumanResponse(stepId, response, now, ctx = {}) {
    if (this._status !== WorkflowStatus.WAITING_FOR_HUMAN) {
      throw new InvalidStateTransitionError(this._status, WorkflowStatus.RUNNING, 'apply_human_response');
    }
    const step = this._findStep(stepId);
    if (!step.isWaitingForHuman()) {
      throw new InvalidStateTransitionError(step.status, WorkflowStatus.COMPLETED, `step:${step.name}`);
    }
    step._resumeFromHuman(now);
    this._transitionWorkflow(WorkflowStatus.RUNNING, now, 'human_response');
    return this.recordStepOutput(stepId, response, now, ctx);
  }

  failStep(stepId, error, now, ctx = {}) {
    const step = this._findStep(stepId);
    if (step.isTerminal()) return [];
    if (step.isCreated()) step._start(now);
    step._fail(error, now);
    const ev = new WorkflowStepFailed({
      workflowId: this._id,
      stepId: step.id,
      error,
      occurredAt: now,
      actor: ctx.actor,
      correlationId: ctx.correlationId,
    });
    this._events.push(ev);
    return [ev, ...this.fail(error?.message ?? String(error), now, ctx)];
  }

  fail(reason, now, ctx = {}) {
    if (isTerminal(this._status)) return [];
    if (!canTransition(this._status, WorkflowStatus.FAILED)) {
      throw new InvalidStateTransitionError(this._status, WorkflowStatus.FAILED);
    }
    this._failureReason = reason ?? null;
    this._transitionWorkflow(WorkflowStatus.FAILED, now, reason);
    this._completedAt = now;
    const ev = new WorkflowFailed({
      workflowId: this._id,
      reason,
      occurredAt: now,
      actor: ctx.actor,
      correlationId: ctx.correlationId,
    });
    this._events.push(ev);
    return [ev];
  }

  cancel(by, reason, now, ctx = {}) {
    if (isTerminal(this._status)) return [];
    if (!canTransition(this._status, WorkflowStatus.CANCELLED)) {
      throw new InvalidStateTransitionError(this._status, WorkflowStatus.CANCELLED);
    }
    this._cancellation = { by: by ?? null, reason: reason ?? null };
    this._transitionWorkflow(WorkflowStatus.CANCELLED, now, reason);
    this._completedAt = now;
    for (const step of this._steps) {
      if (!step.isTerminal()) step._cancel(now);
    }
    const ev = new WorkflowCancelled({
      workflowId: this._id,
      by,
      reason,
      occurredAt: now,
      actor: ctx.actor,
      correlationId: ctx.correlationId,
    });
    this._events.push(ev);
    return [ev];
  }

  _complete(now, ctx = {}) {
    if (!canTransition(this._status, WorkflowStatus.COMPLETED)) {
      throw new InvalidStateTransitionError(this._status, WorkflowStatus.COMPLETED);
    }
    this._transitionWorkflow(WorkflowStatus.COMPLETED, now);
    this._completedAt = now;
    const ev = new WorkflowCompleted({
      workflowId: this._id,
      completedAt: now,
      result: this._context.toJSON(),
      occurredAt: now,
      actor: ctx.actor,
      correlationId: ctx.correlationId,
    });
    this._events.push(ev);
    return [ev];
  }

  _transitionWorkflow(to, at, reason) {
    if (!canTransition(this._status, to)) {
      throw new InvalidStateTransitionError(this._status, to);
    }
    this._transitions.push(new WorkflowTransition({ from: this._status, to, at, reason }));
    this._status = to;
  }

  _ensureRunning(opName) {
    if (this._status !== WorkflowStatus.RUNNING) {
      throw new InvalidStateTransitionError(
        this._status,
        WorkflowStatus.RUNNING,
        opName,
      );
    }
  }

  _findStep(stepId) {
    const s = this._steps.find((x) => x.id === stepId);
    if (!s) throw new StepNotFoundError(this._id, stepId);
    return s;
  }

  pullEvents() {
    const out = this._events;
    this._events = [];
    return out;
  }

  _bumpVersion() { this._version += 1; }

  toState() {
    return {
      id: this._id,
      templateKey: this._templateKey,
      templateVersion: this._templateVersion,
      context: this._context.toJSON(),
      status: this._status,
      steps: this._steps.map((s) => s.toJSON()),
      transitions: this._transitions.map((t) => t.toJSON()),
      createdBy: this._createdBy,
      createdAt: this._createdAt,
      startedAt: this._startedAt,
      completedAt: this._completedAt,
      failureReason: this._failureReason,
      cancellation: this._cancellation,
      version: this._version,
    };
  }
}

function toDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  return new Date(v);
}

function defaultStepIdGen(workflowId) {
  let n = 0;
  return {
    next: () => {
      n += 1;
      return `${workflowId}-step-${n}`;
    },
  };
}
