/**
 * Domain events emitted by the Human Interaction bounded context.
 *
 * Bridges Phase 3's compact event API to Phase 0's strict DomainEvent
 * envelope by filling sensible defaults for fields the Phase 3 callers
 * do not yet supply (eventId, eventVersion, actor).
 */
import { randomUUID } from 'node:crypto';
import { DomainEvent } from '../../../shared-kernel/domain/domain-event.js';

export const HUMAN_RESPONSE_RECORDED = 'human_response.recorded';
export const HUMAN_STEP_ESCALATED = 'human_step.escalated';
export const HUMAN_STEP_DEADLINE_PASSED = 'human_step.deadline_passed';

function envelope({ eventType, aggregateId, aggregateType, payload, occurredAt, correlationId, actor, eventId, eventVersion }) {
  return {
    eventId: eventId ?? randomUUID(),
    eventType,
    eventVersion: eventVersion ?? 1,
    occurredAt: occurredAt ?? new Date().toISOString(),
    aggregateId,
    aggregateType,
    correlationId: correlationId ?? randomUUID(),
    actor: actor ?? { type: 'system' },
    payload,
  };
}

export class HumanResponseRecorded extends DomainEvent {
  constructor({ humanResponseId, workflowId, stepId, action, payload, by, occurredAt, correlationId, actor }) {
    super(envelope({
      eventType: HUMAN_RESPONSE_RECORDED,
      aggregateId: humanResponseId,
      aggregateType: 'HumanResponse',
      payload: { workflow_id: workflowId, step_id: stepId, action, payload, by },
      occurredAt,
      correlationId,
      actor: actor ?? (by ? { type: 'user', id: by } : undefined),
    }));
  }
}

export class HumanStepEscalated extends DomainEvent {
  constructor({ workflowId, stepId, level, reason, occurredAt, correlationId, actor }) {
    super(envelope({
      eventType: HUMAN_STEP_ESCALATED,
      aggregateId: `${workflowId}:${stepId}`,
      aggregateType: 'PendingStep',
      payload: { workflow_id: workflowId, step_id: stepId, level, reason },
      occurredAt,
      correlationId,
      actor,
    }));
  }
}

export class HumanStepDeadlinePassed extends DomainEvent {
  constructor({ workflowId, stepId, policy, occurredAt, correlationId, actor }) {
    super(envelope({
      eventType: HUMAN_STEP_DEADLINE_PASSED,
      aggregateId: `${workflowId}:${stepId}`,
      aggregateType: 'PendingStep',
      payload: { workflow_id: workflowId, step_id: stepId, policy },
      occurredAt,
      correlationId,
      actor,
    }));
  }
}
