import {
  ConflictError,
  DomainError,
  NotFoundError,
} from '../shared-kernel-stubs.js';

/** Raised when a template lookup fails. */
export class TemplateNotFoundError extends NotFoundError {
  constructor(key, version) {
    super(
      version
        ? `Workflow template not found: ${key}@${version}`
        : `Workflow template not found: ${key}`,
    );
    this.templateKey = key;
    this.version = version;
  }
}

/** Raised when a workflow lookup fails. */
export class WorkflowNotFoundError extends NotFoundError {
  constructor(id) {
    super(`Workflow not found: ${id}`);
    this.workflowId = id;
  }
}

/** Raised when a step lookup inside a workflow fails. */
export class StepNotFoundError extends NotFoundError {
  constructor(workflowId, stepId) {
    super(`Step not found: workflow=${workflowId} step=${stepId}`);
    this.workflowId = workflowId;
    this.stepId = stepId;
  }
}

/**
 * Raised when an aggregate is asked to make a transition the FSM
 * does not allow.
 */
export class InvalidStateTransitionError extends DomainError {
  constructor(from, to, context) {
    super(
      `Invalid state transition: ${from} → ${to}${context ? ` (${context})` : ''}`,
      'INVALID_STATE_TRANSITION',
    );
    this.from = from;
    this.to = to;
    this.context = context;
  }
}

/** Raised on optimistic-concurrency mismatch when saving a workflow. */
export class WorkflowConflictError extends ConflictError {
  constructor(workflowId, expectedVersion, actualVersion) {
    super(
      `Workflow ${workflowId} version conflict: expected ${expectedVersion}, found ${actualVersion}`,
    );
    this.workflowId = workflowId;
    this.expectedVersion = expectedVersion;
    this.actualVersion = actualVersion;
  }
}

/** Raised when a template is mutated after publication. */
export class TemplateImmutableError extends DomainError {
  constructor(key, version) {
    super(
      `Template ${key}@${version} is published and immutable`,
      'TEMPLATE_IMMUTABLE',
    );
    this.templateKey = key;
    this.version = version;
  }
}
