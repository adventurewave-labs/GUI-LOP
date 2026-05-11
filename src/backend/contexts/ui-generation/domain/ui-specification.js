/**
 * UISpecification — aggregate root that captures the desired UI for a step
 * before component resolution / strategy selection.
 *
 * Invariants:
 *   - Field ids are unique within the spec.
 *   - Each validation rule's `id` is unique across the spec.
 *   - Every component reference (in field.component or layout) must be
 *     resolvable from the supplied catalogue at construction time when one
 *     is provided.
 */
import { ValidationError } from '../../../shared-kernel/domain/errors.js';
import { Field } from './field.js';
import { Layout } from './layout.js';

export class UISpecification {
  constructor({ id, workflowId, stepId, title, fields = [], layout, strategyHint }, { catalogue } = {}) {
    if (!id) throw new ValidationError('UISpecification.id is required');
    if (!workflowId) throw new ValidationError('UISpecification.workflowId is required');
    if (!stepId) throw new ValidationError('UISpecification.stepId is required');

    const builtFields = fields.map((f) => (f instanceof Field ? f : Field.of(f)));
    this._assertUniqueFieldIds(builtFields);
    this._assertUniqueValidationIds(builtFields);
    if (catalogue) this._assertComponentsResolvable(builtFields, catalogue);

    this.id = id;
    this.workflowId = workflowId;
    this.stepId = stepId;
    this.title = title ?? null;
    this.fields = Object.freeze(builtFields);
    this.layout = layout ? (layout instanceof Layout ? layout : Layout.of(layout)) : null;
    this.strategyHint = strategyHint ?? null;
    Object.freeze(this);
  }

  static create(spec, deps = {}) {
    return new UISpecification(spec, deps);
  }

  _assertUniqueFieldIds(fields) {
    const seen = new Set();
    for (const f of fields) {
      if (seen.has(f.id)) {
        throw new ValidationError(`Duplicate field id in spec: ${f.id}`);
      }
      seen.add(f.id);
    }
  }

  _assertUniqueValidationIds(fields) {
    const seen = new Set();
    for (const f of fields) {
      for (const v of f.validations) {
        if (seen.has(v.id)) {
          throw new ValidationError(`Duplicate validation rule id: ${v.id}`);
        }
        seen.add(v.id);
      }
    }
  }

  _assertComponentsResolvable(fields, catalogue) {
    for (const f of fields) {
      if (f.component && !catalogue.has(f.component.name, f.component.version)) {
        throw new ValidationError(
          `Component not in catalogue: ${f.component.toString()}`
        );
      }
    }
  }

  toJSON() {
    return {
      id: this.id,
      workflowId: this.workflowId,
      stepId: this.stepId,
      title: this.title,
      fields: this.fields.map((f) => f.toJSON()),
      layout: this.layout ? this.layout.toJSON() : null,
      strategyHint: this.strategyHint
    };
  }
}
