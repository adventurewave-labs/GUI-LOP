/**
 * UIDocument — aggregate. Bound to (workflowId, stepId), immutable.
 */

import { ValidationError } from '../../../shared/kernel/errors.js';

export class UIDocument {
  constructor({ id, workflowId, stepId, url, contentRef, strategy, version = 1, generatedAt }) {
    if (!id) throw new ValidationError('UIDocument.id is required');
    if (!workflowId) throw new ValidationError('UIDocument.workflowId is required');
    if (!stepId) throw new ValidationError('UIDocument.stepId is required');
    if (!url) throw new ValidationError('UIDocument.url is required');
    if (!contentRef) throw new ValidationError('UIDocument.contentRef is required');
    if (!strategy) throw new ValidationError('UIDocument.strategy is required');

    this.id = id;
    this.workflowId = workflowId;
    this.stepId = stepId;
    this.url = url;
    this.contentRef = contentRef;
    this.strategy = strategy;
    this.version = version;
    this.generatedAt = generatedAt ?? new Date().toISOString();
    Object.freeze(this);
  }

  toJSON() {
    return {
      id: this.id,
      workflowId: this.workflowId,
      stepId: this.stepId,
      url: this.url,
      contentRef: this.contentRef,
      strategy: this.strategy,
      version: this.version,
      generatedAt: this.generatedAt
    };
  }
}
