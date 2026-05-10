/**
 * Domain events emitted by the Human Interaction bounded context.
 */
import { DomainEvent } from '../../../shared-kernel/domain/domain-event.js';

export const HUMAN_RESPONSE_RECORDED = 'human_response.recorded';
export const HUMAN_STEP_ESCALATED = 'human_step.escalated';
export const HUMAN_STEP_DEADLINE_PASSED = 'human_step.deadline_passed';

export class HumanResponseRecorded extends DomainEvent {
  constructor({ humanResponseId, workflowId, stepId, action, payload, by, occurredAt, correlationId }) {
    super({
      eventType: HUMAN_RESPONSE_RECORDED,
      aggregateId: humanResponseId,
      aggregateType: 'HumanResponse',
      payload: { workflow_id: workflowId, step_id: stepId, action, payload, by },
      occurredAt,
      correlationId,
    });
  }
}

export class HumanStepEscalated extends DomainEvent {
  constructor({ workflowId, stepId, level, reason, occurredAt, correlationId }) {
    super({
      eventType: HUMAN_STEP_ESCALATED,
      aggregateId: `${workflowId}:${stepId}`,
      aggregateType: 'PendingStep',
      payload: { workflow_id: workflowId, step_id: stepId, level, reason },
      occurredAt,
      correlationId,
    });
  }
}

export class HumanStepDeadlinePassed extends DomainEvent {
  constructor({ workflowId, stepId, policy, occurredAt, correlationId }) {
    super({
      eventType: HUMAN_STEP_DEADLINE_PASSED,
      aggregateId: `${workflowId}:${stepId}`,
      aggregateType: 'PendingStep',
      payload: { workflow_id: workflowId, step_id: stepId, policy },
      occurredAt,
      correlationId,
    });
  }
}
