import { ValidationError } from '../../shared-kernel-stubs.js';

export const STEP_KINDS = Object.freeze(['automated', 'human', 'external']);

export const TIMEOUT_POLICIES = Object.freeze([
  'fail',
  'escalate',
  'auto_approve',
]);

/**
 * StepDefinition — value object describing a single step inside a template.
 * Immutable; equality is structural.
 */
export class StepDefinition {
  /**
   * @param {{
   *   name: string,
   *   kind: 'automated'|'human'|'external',
   *   inputSchema?: object,
   *   outputSchema?: object,
   *   uiSpec?: object,
   *   deadline?: number,
   *   onTimeout?: 'fail'|'escalate'|'auto_approve',
   * }} props
   */
  constructor(props) {
    if (!props || typeof props !== 'object') {
      throw new ValidationError('StepDefinition props required', 'step');
    }
    if (typeof props.name !== 'string' || props.name.trim().length === 0) {
      throw new ValidationError('Step name is required', 'step.name');
    }
    if (props.name.length > 255) {
      throw new ValidationError('Step name too long', 'step.name');
    }
    if (!STEP_KINDS.includes(props.kind)) {
      throw new ValidationError(
        `Step kind must be one of ${STEP_KINDS.join(', ')}`,
        'step.kind',
      );
    }
    if (props.deadline !== undefined) {
      if (
        typeof props.deadline !== 'number'
        || !Number.isFinite(props.deadline)
        || props.deadline <= 0
      ) {
        throw new ValidationError(
          'Step deadline must be a positive number of milliseconds',
          'step.deadline',
        );
      }
    }
    const onTimeout = props.onTimeout ?? 'fail';
    if (!TIMEOUT_POLICIES.includes(onTimeout)) {
      throw new ValidationError(
        `onTimeout must be one of ${TIMEOUT_POLICIES.join(', ')}`,
        'step.onTimeout',
      );
    }

    this.name = props.name.trim();
    this.kind = props.kind;
    this.inputSchema = props.inputSchema ? deepFreeze(clone(props.inputSchema)) : undefined;
    this.outputSchema = props.outputSchema ? deepFreeze(clone(props.outputSchema)) : undefined;
    this.uiSpec = props.uiSpec ? deepFreeze(clone(props.uiSpec)) : undefined;
    this.deadline = props.deadline;
    this.onTimeout = onTimeout;
    Object.freeze(this);
  }

  toJSON() {
    return {
      name: this.name,
      kind: this.kind,
      inputSchema: this.inputSchema,
      outputSchema: this.outputSchema,
      uiSpec: this.uiSpec,
      deadline: this.deadline,
      onTimeout: this.onTimeout,
    };
  }

  equals(other) {
    if (!(other instanceof StepDefinition)) return false;
    return JSON.stringify(this.toJSON()) === JSON.stringify(other.toJSON());
  }
}

function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

function deepFreeze(obj) {
  if (obj && typeof obj === 'object') {
    for (const v of Object.values(obj)) deepFreeze(v);
    Object.freeze(obj);
  }
  return obj;
}
