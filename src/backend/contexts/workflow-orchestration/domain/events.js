/**
 * Domain events emitted by the Workflow Orchestration bounded context.
 *
 * Bridges Phase 2's compact event API to Phase 0's strict DomainEvent
 * envelope by filling sensible defaults for fields the callers do not
 * always supply (`eventId`, `eventVersion`, `occurredAt`, `correlationId`,
 * `actor`).
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
    aggregateId,
    aggregateType,
    correlationId: correlationId ?? randomUUID(),
    actor: actor ?? { type: 'system' },
    payload: payload ?? {},
  };
}

/* ---------------- Template events ---------------- */

export class TemplatePublished extends DomainEvent {
  constructor({ templateKey, version, occurredAt, actor, correlationId }) {
    super(envelope({
      eventType: 'workflow_orchestration.template.published',
      aggregateType: 'WorkflowTemplate',
      aggregateId: `${templateKey}@${version}`,
      payload: { template_key: templateKey, version },
      occurredAt,
      actor,
      correlationId,
    }));
  }
}

export class TemplateDeprecated extends DomainEvent {
  constructor({ templateKey, version, occurredAt, actor, correlationId }) {
    super(envelope({
      eventType: 'workflow_orchestration.template.deprecated',
      aggregateType: 'WorkflowTemplate',
      aggregateId: `${templateKey}@${version}`,
      payload: { template_key: templateKey, version },
      occurredAt,
      actor,
      correlationId,
    }));
  }
}

/* ---------------- Workflow lifecycle events ---------------- */

export class WorkflowCreated extends DomainEvent {
  constructor({ workflowId, templateKey, version, context, occurredAt, actor, correlationId }) {
    super(envelope({
      eventType: 'workflow_orchestration.workflow.created',
      aggregateType: 'Workflow',
      aggregateId: workflowId,
      payload: {
        workflow_id: workflowId,
        template_key: templateKey,
        version,
        context,
      },
      occurredAt,
      actor,
      correlationId,
    }));
  }
}

export class WorkflowStarted extends DomainEvent {
  constructor({ workflowId, startedAt, occurredAt, actor, correlationId }) {
    super(envelope({
      eventType: 'workflow_orchestration.workflow.started',
      aggregateType: 'Workflow',
      aggregateId: workflowId,
      payload: {
        workflow_id: workflowId,
        started_at: startedAt instanceof Date ? startedAt.toISOString() : startedAt,
      },
      occurredAt,
      actor,
      correlationId,
    }));
  }
}

export class WorkflowStepStarted extends DomainEvent {
  constructor({ workflowId, stepId, stepName, occurredAt, actor, correlationId }) {
    super(envelope({
      eventType: 'workflow_orchestration.workflow.step_started',
      aggregateType: 'Workflow',
      aggregateId: workflowId,
      payload: {
        workflow_id: workflowId,
        step_id: stepId,
        step_name: stepName,
      },
      occurredAt,
      actor,
      correlationId,
    }));
  }
}

export class WorkflowStepCompleted extends DomainEvent {
  constructor({ workflowId, stepId, output, occurredAt, actor, correlationId }) {
    super(envelope({
      eventType: 'workflow_orchestration.workflow.step_completed',
      aggregateType: 'Workflow',
      aggregateId: workflowId,
      payload: {
        workflow_id: workflowId,
        step_id: stepId,
        output,
      },
      occurredAt,
      actor,
      correlationId,
    }));
  }
}

export class WorkflowStepFailed extends DomainEvent {
  constructor({ workflowId, stepId, error, occurredAt, actor, correlationId }) {
    super(envelope({
      eventType: 'workflow_orchestration.workflow.step_failed',
      aggregateType: 'Workflow',
      aggregateId: workflowId,
      payload: {
        workflow_id: workflowId,
        step_id: stepId,
        error: error
          ? { message: error.message ?? String(error), code: error.code }
          : null,
      },
      occurredAt,
      actor,
      correlationId,
    }));
  }
}

export class WorkflowHumanInputRequired extends DomainEvent {
  constructor({ workflowId, stepId, uiSpec, occurredAt, actor, correlationId }) {
    super(envelope({
      eventType: 'workflow_orchestration.workflow.human_input_required',
      aggregateType: 'Workflow',
      aggregateId: workflowId,
      payload: {
        workflow_id: workflowId,
        step_id: stepId,
        ui_spec: uiSpec ?? null,
      },
      occurredAt,
      actor,
      correlationId,
    }));
  }
}

export class WorkflowCompleted extends DomainEvent {
  constructor({ workflowId, completedAt, result, occurredAt, actor, correlationId }) {
    super(envelope({
      eventType: 'workflow_orchestration.workflow.completed',
      aggregateType: 'Workflow',
      aggregateId: workflowId,
      payload: {
        workflow_id: workflowId,
        completed_at:
          completedAt instanceof Date ? completedAt.toISOString() : completedAt,
        result: result ?? null,
      },
      occurredAt,
      actor,
      correlationId,
    }));
  }
}

export class WorkflowFailed extends DomainEvent {
  constructor({ workflowId, reason, occurredAt, actor, correlationId }) {
    super(envelope({
      eventType: 'workflow_orchestration.workflow.failed',
      aggregateType: 'Workflow',
      aggregateId: workflowId,
      payload: { workflow_id: workflowId, reason: reason ?? null },
      occurredAt,
      actor,
      correlationId,
    }));
  }
}

export class WorkflowCancelled extends DomainEvent {
  constructor({ workflowId, by, reason, occurredAt, actor, correlationId }) {
    super(envelope({
      eventType: 'workflow_orchestration.workflow.cancelled',
      aggregateType: 'Workflow',
      aggregateId: workflowId,
      payload: { workflow_id: workflowId, by: by ?? null, reason: reason ?? null },
      occurredAt,
      actor,
      correlationId,
    }));
  }
}
