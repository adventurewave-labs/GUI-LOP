/**
 * RecordHumanResponse use case.
 *
 * Full flow:
 *   1. Idempotency check on (workflowId, stepId, idempotencyKey). If a
 *      response with the same key already exists, return it — even if the
 *      pending step has since been closed by the original successful call.
 *   2. Load the pending step (must exist and be open).
 *   3. Authorise the actor (Identity port: workflow:respond on workflow id).
 *   4. Hydrate the responder's directory snapshot.
 *   5. Check eligibility against the pending step.
 *   6. If a different response already exists for this step, raise
 *      ResponseConflictError (winner-takes-all).
 *   7. Validate (action, payload) against the step's UI spec.
 *   8. Construct HumanResponse, persist, publish events, close pending step.
 *   9. Call WorkflowAdvancer to resume the workflow.
 */
import { HumanResponse } from '../../domain/human-response/human-response.js';
import { ResponseValidationService } from '../../domain/services/response-validation-service.js';
import { EligibilityService } from '../../domain/services/eligibility-service.js';
import {
  IneligibleResponderError,
  StepNotPendingError,
  ResponseConflictError,
} from '../../domain/errors.js';
import { ForbiddenError } from '../../../../shared-kernel/domain/errors.js';

export class RecordHumanResponse {
  /**
   * @param {object} deps
   * @param {import('../ports/human-response-repository.js').HumanResponseRepository} deps.responseRepository
   * @param {import('../ports/pending-step-repository.js').PendingStepRepository} deps.pendingStepRepository
   * @param {import('../ports/workflow-reader.js').WorkflowReader} deps.workflowReader
   * @param {import('../ports/user-directory-reader.js').UserDirectoryReader} deps.userDirectory
   * @param {import('../ports/authorisation-service.js').AuthorisationService} deps.authorisation
   * @param {import('../ports/workflow-advancer.js').WorkflowAdvancer} deps.workflowAdvancer
   * @param {import('../ports/event-publisher.js').EventPublisher} deps.eventPublisher
   * @param {import('../ports/unit-of-work.js').UnitOfWorkFactory} deps.unitOfWork
   * @param {import('../ports/clock.js').Clock} deps.clock
   * @param {import('../ports/id-generator.js').IdGenerator} deps.ids
   * @param {(step: object) => import('../../domain/services/response-validation-service.js').ResponseValidationService} [deps.validatorFactory]
   */
  constructor(deps) {
    this.responseRepository = deps.responseRepository;
    this.pendingStepRepository = deps.pendingStepRepository;
    this.workflowReader = deps.workflowReader;
    this.userDirectory = deps.userDirectory;
    this.authorisation = deps.authorisation;
    this.workflowAdvancer = deps.workflowAdvancer;
    this.eventPublisher = deps.eventPublisher;
    this.unitOfWork = deps.unitOfWork;
    this.clock = deps.clock;
    this.ids = deps.ids;
    this.validatorFactory = deps.validatorFactory ?? ((step) => ResponseValidationService.forStep(step));
  }

  /**
   * @param {object} command
   * @param {string} command.workflowId
   * @param {string} command.stepId
   * @param {string} command.action
   * @param {object} command.payload
   * @param {string} [command.rationale]
   * @param {number} [command.confidence]
   * @param {{ userId: string, sessionId?: string }} command.actor
   * @param {string} command.idempotencyKey
   */
  async execute(command) {
    const { workflowId, stepId, action, payload, rationale, confidence, actor, idempotencyKey } = command;
    if (!workflowId || !stepId) {
      throw new StepNotPendingError('workflowId and stepId are required');
    }
    if (!actor || !actor.userId) {
      throw new ForbiddenError('Actor is required');
    }
    if (!idempotencyKey) {
      throw new ResponseConflictError('idempotencyKey is required for response submission');
    }

    // 1. Idempotency check first — a retried request must succeed even if the
    //    pending step is already closed (since the previous successful call
    //    closed it).
    const existingByKey = await this.responseRepository.findByIdempotencyKey(workflowId, stepId, idempotencyKey);
    if (existingByKey) {
      return { response: existingByKey, deduplicated: true };
    }

    // 2. Load pending step.
    const pendingStep = await this.pendingStepRepository.findByKey(workflowId, stepId);
    if (!pendingStep || pendingStep.isClosed()) {
      throw new StepNotPendingError('No open pending step for this (workflow, step)', {
        workflowId,
        stepId,
      });
    }

    // 3. Authorise.
    const authResult = await this.authorisation.authorise({
      actor,
      permission: 'workflow:respond',
      scope: workflowId,
    });
    if (!authResult || !authResult.authorised) {
      throw new IneligibleResponderError(authResult?.reason ?? 'Not authorised', {
        permission: 'workflow:respond',
        workflowId,
      });
    }

    // 4. Load workflow + responder snapshot for eligibility.
    const workflow = (await this.workflowReader.getSummary(workflowId)) ?? { id: workflowId };
    const userSnapshot = authResult.user ?? (await this.userDirectory.getUser(actor.userId));
    if (!userSnapshot) {
      throw new IneligibleResponderError('Responder not found in directory', { userId: actor.userId });
    }

    // 5. Eligibility.
    if (!EligibilityService.eligibleFor(userSnapshot, pendingStep, workflow)) {
      throw new IneligibleResponderError('Responder does not meet eligibility for this step', {
        userId: actor.userId,
        workflowId,
        stepId,
      });
    }

    // 6. Different key but a response already exists -> conflict (winner-takes-all).
    const existingForStep = await this.responseRepository.findFor(workflowId, stepId);
    if (existingForStep) {
      throw new ResponseConflictError('A response has already been recorded for this step', {
        workflowId,
        stepId,
        winningResponseId: existingForStep.id,
      });
    }

    // 7. Build validator from step descriptor (allowedActions + responseSchema).
    const stepDescriptor = await this._stepDescriptor(workflow, stepId);
    const validator = this.validatorFactory(stepDescriptor);

    // 8. Construct + persist + publish.
    const now = this.clock.now();
    const response = HumanResponse.record({
      id: this.ids.next(),
      workflowId,
      stepId,
      responder: actor.userId,
      action,
      payload,
      rationale,
      confidence,
      idempotencyKey,
      now,
      validator,
    });

    const uow = await this.unitOfWork.start();
    try {
      await this.responseRepository.save(response, uow);
      pendingStep.close(now);
      await this.pendingStepRepository.upsert(pendingStep, uow);
      await this.eventPublisher.publish(response.pendingEvents(), uow);
      await uow.commit();
    } catch (err) {
      await uow.rollback();
      throw err;
    }

    // 9. Tell Workflow Orchestration to resume.
    await this.workflowAdvancer.advance({
      workflowId,
      stepId,
      response: response.toState(),
    });

    return { response, deduplicated: false };
  }

  async _stepDescriptor(workflow, stepId) {
    if (workflow && Array.isArray(workflow.steps)) {
      const found = workflow.steps.find((s) => s.id === stepId);
      if (found) return found;
    }
    if (typeof this.workflowReader.getStep === 'function') {
      const step = await this.workflowReader.getStep(workflow.id ?? workflow, stepId);
      if (step) return step;
    }
    return {};
  }
}
