import { WorkflowNotFoundError } from '../../domain/errors.js';
import { WorkflowStatus } from '../../domain/workflow/workflow-status.js';
import { WorkflowEngine } from '../services/engine.js';

/**
 * Resume a paused or in-flight workflow.
 *
 * Two distinct call patterns flow through here:
 *
 *   1. **Human response.** The Human Interaction context, after
 *      recording a response on the aggregate of pending steps, asks
 *      Orchestration to resume by calling `execute({ workflowId, stepId, response })`.
 *      In that case we MUST apply the response to the `Workflow`
 *      aggregate so the matching step transitions
 *      `waiting_for_human → running → completed` and the workflow
 *      itself can leave `waiting_for_human`. Without this, the engine
 *      loop would see the workflow still parked and stop.
 *
 *   2. **External callback / scheduler tick.** Some other actor (the
 *      deadline watcher, an out-of-process step runner posting back)
 *      asks us to re-run the engine without supplying a step or
 *      response. In that case we just run the engine — the aggregate
 *      already knows what to do next.
 *
 * The aggregate's `save()` enforces optimistic concurrency on
 * `Workflow.version`; a concurrent advance racing against us will
 * surface as a `WorkflowConflictError` from the repository.
 */
export class AdvanceWorkflowUseCase {
  constructor({
    workflows,
    templates,
    clock,
    automatedRunner,
    externalRunner,
    uiGeneration,
  }) {
    this._workflows = workflows;
    this._templates = templates;
    this._clock = clock;
    this._automatedRunner = automatedRunner;
    this._externalRunner = externalRunner;
    this._uiGeneration = uiGeneration;
  }

  async execute(input) {
    const wf = await this._workflows.findById(input.workflowId);
    if (!wf) throw new WorkflowNotFoundError(input.workflowId);
    if (
      wf.status === WorkflowStatus.COMPLETED
      || wf.status === WorkflowStatus.FAILED
      || wf.status === WorkflowStatus.CANCELLED
    ) {
      return {
        workflowId: wf.id,
        status: wf.status,
        stoppedReason: 'already_terminal',
        ranSteps: 0,
      };
    }

    // 1. If the caller is delivering a human response, apply it BEFORE
    //    running the engine. This is what unblocks workflows parked on
    //    `waiting_for_human`. `applyHumanResponse` validates that the
    //    workflow is in `waiting_for_human`, validates the stepId
    //    (raising `StepNotFoundError` if unknown), records the response
    //    on the step, and transitions the workflow back to `running`.
    if (input.stepId && input.response !== undefined && input.response !== null) {
      wf.applyHumanResponse(
        input.stepId,
        input.response,
        this._clock.now(),
        { actor: input.actor },
      );
    }

    // 2. Re-run the engine until it can't make further progress.
    const engine = new WorkflowEngine({
      clock: this._clock,
      automatedRunner: this._automatedRunner,
      externalRunner: this._externalRunner,
      uiGeneration: this._uiGeneration,
      templateLookup: async (k, v) => this._templates.findVersion(k, v),
      actor: input.actor,
    });
    const result = await engine.run(wf);

    // 3. Persist. Optimistic-concurrency check lives in the repository.
    await this._workflows.save(wf);
    return {
      workflowId: wf.id,
      status: wf.status,
      stoppedReason: result.stoppedReason,
      ranSteps: result.ranSteps,
    };
  }
}
