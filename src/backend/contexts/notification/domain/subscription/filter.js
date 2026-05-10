/**
 * Filter — value object describing which events match a subscription.
 *
 * Empty arrays mean "match everything" for that dimension.
 */

import { ValidationError } from '../../../../shared/kernel/errors.js';

export class Filter {
  constructor({ eventTypes = [], workflowIds = [] } = {}) {
    if (!Array.isArray(eventTypes)) {
      throw new ValidationError('eventTypes must be an array');
    }
    if (!Array.isArray(workflowIds)) {
      throw new ValidationError('workflowIds must be an array');
    }
    this.eventTypes = Object.freeze([...eventTypes]);
    this.workflowIds = Object.freeze([...workflowIds]);
    Object.freeze(this);
  }

  static of(spec) {
    return new Filter(spec ?? {});
  }

  /**
   * Returns true if the given domain event matches this filter.
   */
  matches(event) {
    if (!event || typeof event !== 'object') return false;

    if (this.eventTypes.length > 0) {
      if (!this.eventTypes.includes(event.type)) return false;
    }

    if (this.workflowIds.length > 0) {
      const wf =
        event.workflowId ??
        event.payload?.workflowId ??
        (event.aggregateType === 'Workflow' ? event.aggregateId : undefined);
      if (!wf || !this.workflowIds.includes(wf)) return false;
    }

    return true;
  }

  isEmpty() {
    return this.eventTypes.length === 0 && this.workflowIds.length === 0;
  }

  toJSON() {
    return {
      eventTypes: [...this.eventTypes],
      workflowIds: [...this.workflowIds]
    };
  }
}
