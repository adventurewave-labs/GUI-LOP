import { WorkflowNotFoundError } from '../../domain/errors.js';
import { WorkflowStatus } from '../../domain/workflow/workflow-status.js';
import { WorkflowEngine } from '../services/engine.js';

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
    const engine = new WorkflowEngine({
      clock: this._clock,
      automatedRunner: this._automatedRunner,
      externalRunner: this._externalRunner,
      uiGeneration: this._uiGeneration,
      templateLookup: async (k, v) => this._templates.findVersion(k, v),
      actor: input.actor,
    });
    const result = await engine.run(wf);
    await this._workflows.save(wf);
    return {
      workflowId: wf.id,
      status: wf.status,
      stoppedReason: result.stoppedReason,
      ranSteps: result.ranSteps,
    };
  }
}
