import { ValidationError } from '../../shared-kernel-stubs.js';
import {
  TemplateDeprecated,
  TemplatePublished,
} from '../events.js';
import {
  InvalidStateTransitionError,
  TemplateImmutableError,
} from '../errors.js';
import { StepDefinition } from './step-definition.js';
import { TemplateKey } from './template-key.js';
import { TemplateVersion } from './template-version.js';

const STATUS = Object.freeze({
  DRAFT: 'draft',
  PUBLISHED: 'published',
  DEPRECATED: 'deprecated',
});

/**
 * WorkflowTemplate aggregate root.
 *
 * Identity is `(templateKey, version)`. A template is `draft` when first
 * authored, `published` (immutable) once finalised, and may later be
 * `deprecated`. Steps may only be appended while in draft.
 */
export class WorkflowTemplate {
  /** @private */
  constructor(state) {
    this._key = state.key;
    this._version = state.version;
    this._name = state.name;
    this._description = state.description;
    this._steps = [...state.steps];
    this._defaultConfig = state.defaultConfig ?? {};
    this._status = state.status;
    this._createdAt = state.createdAt;
    this._updatedAt = state.updatedAt;
    this._publishedAt = state.publishedAt ?? null;
    this._deprecatedAt = state.deprecatedAt ?? null;
    this._createdBy = state.createdBy ?? null;
    this._events = [];
  }

  /* ---------- accessors ---------- */
  get key() { return this._key; }
  get version() { return this._version; }
  get name() { return this._name; }
  get description() { return this._description; }
  get steps() { return [...this._steps]; }
  get defaultConfig() { return JSON.parse(JSON.stringify(this._defaultConfig)); }
  get status() { return this._status; }
  get createdAt() { return this._createdAt; }
  get updatedAt() { return this._updatedAt; }
  get publishedAt() { return this._publishedAt; }
  get deprecatedAt() { return this._deprecatedAt; }
  get createdBy() { return this._createdBy; }

  isDraft() { return this._status === STATUS.DRAFT; }
  isPublished() { return this._status === STATUS.PUBLISHED; }
  isDeprecated() { return this._status === STATUS.DEPRECATED; }

  /* ---------- factories ---------- */

  /**
   * Create a brand-new draft template.
   */
  static draft(props) {
    if (!props || !props.now) {
      throw new ValidationError('draft() requires a clock value (now)', 'now');
    }
    const key = props.key instanceof TemplateKey ? props.key : TemplateKey.of(props.key);
    const version = props.version instanceof TemplateVersion
      ? props.version
      : TemplateVersion.of(props.version ?? 1);
    if (typeof props.name !== 'string' || props.name.trim().length === 0) {
      throw new ValidationError('Template name is required', 'name');
    }

    return new WorkflowTemplate({
      key,
      version,
      name: props.name.trim(),
      description: props.description ?? '',
      steps: [],
      defaultConfig: props.defaultConfig ?? {},
      status: STATUS.DRAFT,
      createdAt: props.now,
      updatedAt: props.now,
      createdBy: props.createdBy ?? null,
    });
  }

  static rehydrate(state) {
    return new WorkflowTemplate({
      ...state,
      steps: state.steps.map((s) =>
        s instanceof StepDefinition ? s : new StepDefinition(s),
      ),
      key: state.key instanceof TemplateKey ? state.key : TemplateKey.of(state.key),
      version: state.version instanceof TemplateVersion
        ? state.version
        : TemplateVersion.of(state.version),
      createdAt: state.createdAt instanceof Date ? state.createdAt : new Date(state.createdAt),
      updatedAt: state.updatedAt instanceof Date ? state.updatedAt : new Date(state.updatedAt),
      publishedAt: state.publishedAt
        ? (state.publishedAt instanceof Date ? state.publishedAt : new Date(state.publishedAt))
        : null,
      deprecatedAt: state.deprecatedAt
        ? (state.deprecatedAt instanceof Date ? state.deprecatedAt : new Date(state.deprecatedAt))
        : null,
    });
  }

  /* ---------- behaviour ---------- */

  addStep(step, now) {
    if (!this.isDraft()) {
      throw new TemplateImmutableError(this._key.value, this._version.value);
    }
    const def = step instanceof StepDefinition ? step : new StepDefinition(step);
    if (this._steps.some((s) => s.name === def.name)) {
      throw new ValidationError(`Duplicate step name: ${def.name}`, 'steps');
    }
    this._steps.push(def);
    this._updatedAt = now ?? this._updatedAt;
    return this;
  }

  validateStructure() {
    if (this._steps.length === 0) {
      throw new ValidationError('Template must have at least one step', 'steps');
    }
    const names = new Set();
    for (const step of this._steps) {
      if (names.has(step.name)) {
        throw new ValidationError(`Duplicate step name: ${step.name}`, 'steps');
      }
      names.add(step.name);
    }
    return true;
  }

  publish(ctx) {
    if (this._status === STATUS.PUBLISHED) return [];
    if (this._status === STATUS.DEPRECATED) {
      throw new InvalidStateTransitionError(this._status, STATUS.PUBLISHED);
    }
    this.validateStructure();

    this._status = STATUS.PUBLISHED;
    this._publishedAt = ctx.now;
    this._updatedAt = ctx.now;

    const event = new TemplatePublished({
      templateKey: this._key.value,
      version: this._version.value,
      occurredAt: ctx.now,
      actor: ctx.actor,
      correlationId: ctx.correlationId,
    });
    this._events.push(event);
    return [event];
  }

  deprecate(ctx) {
    if (this._status === STATUS.DEPRECATED) return [];
    if (this._status !== STATUS.PUBLISHED) {
      throw new InvalidStateTransitionError(this._status, STATUS.DEPRECATED);
    }
    this._status = STATUS.DEPRECATED;
    this._deprecatedAt = ctx.now;
    this._updatedAt = ctx.now;

    const event = new TemplateDeprecated({
      templateKey: this._key.value,
      version: this._version.value,
      occurredAt: ctx.now,
      actor: ctx.actor,
      correlationId: ctx.correlationId,
    });
    this._events.push(event);
    return [event];
  }

  pullEvents() {
    const out = this._events;
    this._events = [];
    return out;
  }
}

export const TEMPLATE_STATUS = STATUS;
