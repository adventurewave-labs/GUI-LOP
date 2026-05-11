/**
 * Event handler: subscribes to Workflow Orchestration's
 * `workflow.human_input_required` event and creates (or refreshes) the
 * PendingStep projection in the Human Interaction context.
 *
 * The handler is deliberately tolerant: if the projection already exists
 * for `(workflowId, stepId)` we leave it open and update mutable fields
 * (eligibility, deadline) but never reset the escalation level downward.
 */
import { PendingStep } from '../../domain/pending-step/pending-step.js';

export class OnWorkflowHumanInputRequired {
  constructor({ pendingStepRepository, unitOfWork, clock }) {
    this.pendingStepRepository = pendingStepRepository;
    this.unitOfWork = unitOfWork;
    this.clock = clock;
  }

  /**
   * @param {object} event Domain event with `payload` carrying the workflow
   *                       and step identifiers, the UI document id and the
   *                       eligibility/deadline.
   */
  async handle(event) {
    const payload = event?.payload ?? event ?? {};
    const workflowId = payload.workflow_id ?? payload.workflowId;
    const stepId = payload.step_id ?? payload.stepId;
    if (!workflowId || !stepId) return;

    const now = this.clock.now();
    const existing = await this.pendingStepRepository.findByKey(workflowId, stepId);

    let step;
    if (existing && !existing.isClosed()) {
      // Update mutable fields without resetting escalation_level.
      step = existing;
      if (payload.eligibility) {
        step.eligibility = (await import('../../domain/pending-step/eligibility-rule.js'))
          .EligibilityRule.of(payload.eligibility);
      }
      if (payload.deadline) {
        step.deadline = payload.deadline instanceof Date ? payload.deadline : new Date(payload.deadline);
      }
      if (payload.ui_document_id || payload.uiDocumentId) {
        step.uiDocumentId = payload.ui_document_id ?? payload.uiDocumentId;
      }
    } else {
      step = PendingStep.open({
        workflowId,
        stepId,
        uiDocumentId: payload.ui_document_id ?? payload.uiDocumentId ?? null,
        eligibility: payload.eligibility ?? {},
        deadline: payload.deadline ? new Date(payload.deadline) : null,
        onTimeout: payload.on_timeout ?? payload.onTimeout ?? 'escalate',
        now,
      });
    }

    const uow = await this.unitOfWork.start();
    try {
      await this.pendingStepRepository.upsert(step, uow);
      await uow.commit();
    } catch (err) {
      await uow.rollback();
      throw err;
    }
  }
}
