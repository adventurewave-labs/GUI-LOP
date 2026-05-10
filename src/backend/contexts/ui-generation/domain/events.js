/**
 * Domain events emitted by the UI Generation bounded context.
 *
 * Bridges Phase 5's compact event API (`type`/`version`) to the strict
 * Phase 0 DomainEvent envelope.
 */
import { randomUUID } from 'node:crypto';
import { DomainEvent } from '../../../shared-kernel/domain/domain-event.js';

function envelope({
  eventType,
  aggregateId,
  aggregateType,
  payload,
  occurredAt,
  correlationId,
  actor,
  eventId,
  eventVersion,
}) {
  return {
    eventId: eventId ?? randomUUID(),
    eventType,
    eventVersion: eventVersion ?? 1,
    occurredAt:
      occurredAt instanceof Date
        ? occurredAt.toISOString()
        : occurredAt ?? new Date().toISOString(),
    aggregateId: aggregateId ?? `${eventType}:${randomUUID()}`,
    aggregateType,
    correlationId: correlationId ?? randomUUID(),
    actor: actor ?? { type: 'system' },
    payload: payload ?? {},
  };
}

export class UIGenerated extends DomainEvent {
  constructor({ documentId, workflowId, stepId, url, strategy, occurredAt, correlationId, actor }) {
    super(envelope({
      eventType: 'ui.generated',
      aggregateId: documentId,
      aggregateType: 'UIDocument',
      payload: { documentId, workflowId, stepId, url, strategy },
      occurredAt,
      correlationId,
      actor,
    }));
  }
}

export class UIGenerationFailed extends DomainEvent {
  constructor({ workflowId, stepId, error, occurredAt, correlationId, actor }) {
    super(envelope({
      eventType: 'ui.generation_failed',
      aggregateId: workflowId && stepId ? `${workflowId}:${stepId}` : undefined,
      aggregateType: 'UIDocument',
      payload: { workflowId, stepId, error },
      occurredAt,
      correlationId,
      actor,
    }));
  }
}
