import { DomainEvent } from '../../../shared/kernel/domain-event.js';

export class UIGenerated extends DomainEvent {
  constructor({ documentId, workflowId, stepId, url, strategy, occurredAt }) {
    super({
      type: 'ui.generated',
      version: 1,
      aggregateId: documentId,
      aggregateType: 'UIDocument',
      payload: { documentId, workflowId, stepId, url, strategy },
      occurredAt
    });
  }
}

export class UIGenerationFailed extends DomainEvent {
  constructor({ workflowId, stepId, error, occurredAt }) {
    super({
      type: 'ui.generation_failed',
      version: 1,
      aggregateType: 'UIDocument',
      payload: { workflowId, stepId, error },
      occurredAt
    });
  }
}
