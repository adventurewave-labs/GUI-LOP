import { ValidationError } from '../../../../shared-kernel/domain/errors.js';
import { InvalidStateTransitionError } from '../errors.js';
import { canStepTransition, ensureStatus, WorkflowStatus } from './workflow-status.js';

/**
 * WorkflowStep — entity inside a Workflow aggregate. Identity is the
 * step's `id`. Mutators are scoped to the parent aggregate; consumers
 * outside the aggregate must go through `Workflow`.
 */
export class WorkflowStep {
  constructor(state) {
    if (!state.id) throw new ValidationError('Step id is required', 'id');
    if (!state.name) throw new ValidationError('Step name is required', 'name');
    if (!state.kind) throw new ValidationError('Step kind is required', 'kind');
    this._id = state.id;
    this._name = state.name;
    this._kind = state.kind;
    this._order = state.order;
    this._status = ensureStatus(state.status ?? WorkflowStatus.CREATED);
    this._inputData = state.inputData ?? null;
    this._outputData = state.outputData ?? null;
    this._uiSpec = state.uiSpec ?? null;
    this._error = state.error ?? null;
    this._startedAt = state.startedAt ?? null;
    this._completedAt = state.completedAt ?? null;
    this._deadline = state.deadline ?? null;
    this._onTimeout = state.onTimeout ?? 'fail';
  }

  get id() { return this._id; }
  get name() { return this._name; }
  get kind() { return this._kind; }
  get order() { return this._order; }
  get status() { return this._status; }
  get inputData() { return this._inputData; }
  get outputData() { return this._outputData; }
  get uiSpec() { return this._uiSpec; }
  get error() { return this._error; }
  get startedAt() { return this._startedAt; }
  get completedAt() { return this._completedAt; }
  get deadline() { return this._deadline; }
  get onTimeout() { return this._onTimeout; }

  isCreated() { return this._status === WorkflowStatus.CREATED; }
  isRunning() { return this._status === WorkflowStatus.RUNNING; }
  isWaitingForHuman() { return this._status === WorkflowStatus.WAITING_FOR_HUMAN; }
  isCompleted() { return this._status === WorkflowStatus.COMPLETED; }
  isFailed() { return this._status === WorkflowStatus.FAILED; }
  isCancelled() { return this._status === WorkflowStatus.CANCELLED; }
  isTerminal() { return this.isCompleted() || this.isFailed() || this.isCancelled(); }

  _transition(to, ctx = {}) {
    if (!canStepTransition(this._status, to)) {
      throw new InvalidStateTransitionError(this._status, to, `step:${this._name}`);
    }
    this._status = to;
    if (to === WorkflowStatus.RUNNING && !this._startedAt) {
      this._startedAt = ctx.now ?? null;
    }
    if (
      to === WorkflowStatus.COMPLETED
      || to === WorkflowStatus.FAILED
      || to === WorkflowStatus.CANCELLED
    ) {
      this._completedAt = ctx.now ?? this._completedAt ?? null;
    }
  }

  _start(now) { this._transition(WorkflowStatus.RUNNING, { now }); }
  _complete(output, now) {
    this._outputData = output ?? null;
    this._transition(WorkflowStatus.COMPLETED, { now });
  }
  _fail(error, now) {
    this._error = error?.message ?? String(error);
    this._transition(WorkflowStatus.FAILED, { now });
  }
  _markWaitingForHuman(uiSpec, now) {
    this._uiSpec = uiSpec ?? this._uiSpec;
    this._transition(WorkflowStatus.WAITING_FOR_HUMAN, { now });
  }
  _resumeFromHuman(now) {
    this._transition(WorkflowStatus.RUNNING, { now });
  }
  _cancel(now) {
    if (this.isTerminal()) return;
    this._transition(WorkflowStatus.CANCELLED, { now });
  }

  toJSON() {
    return {
      id: this._id,
      name: this._name,
      kind: this._kind,
      order: this._order,
      status: this._status,
      inputData: this._inputData,
      outputData: this._outputData,
      uiSpec: this._uiSpec,
      error: this._error,
      startedAt: this._startedAt instanceof Date ? this._startedAt.toISOString() : this._startedAt,
      completedAt: this._completedAt instanceof Date ? this._completedAt.toISOString() : this._completedAt,
      deadline: this._deadline,
      onTimeout: this._onTimeout,
    };
  }
}
