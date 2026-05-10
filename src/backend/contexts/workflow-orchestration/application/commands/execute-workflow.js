import { ForbiddenError } from '../../shared-kernel-stubs.js';
import { WorkflowNotFoundError } from '../../domain/errors.js';
import { WorkflowStatus } from '../../domain/workflow/workflow-status.js';
import { WorkflowEngine } from '../services/engine.js';

export class ExecuteWorkflowUseCase {
  constructor({
    workflows,
    templates,
    clock,
    authorisation,
    idempotency,
    automatedRunner,
    externalRunner,
    uiGeneration,
  }) {
    this._workflows = workflows;
    this._templates = templates;
    this._clock = clock;
    this._authorisation = authorisation;
    this._idempotency = idempotency;
    this._automatedRunner = automatedRunner;
    this._externalRunner = externalRunner;
    this._uiGeneration = uiGeneration;
  }

  async execute(input) {
    if (this._authorisation) {
      const decision = await this._authorisation.authorise({
        actor: input.actor,
        action: 'workflow:execute',
        resource: { type: 'workflow', id: input.workflowId },
      });
      if (!decision.allowed) throw new ForbiddenError(decision.reason ?? 'forbidden');
    }

    if (input.idempotencyKey && this._idempotency) {
      const existing = await this._idempotency.get({
        actor: input.actor.id,
        route: `execute_workflow:${input.workflowId}`,
        key: input.idempotencyKey,
      });
      if (existing) return existing.response;
    }

    const wf = await this._workflows.findById(input.workflowId);
    if (!wf) throw new WorkflowNotFoundError(input.workflowId);

    if (wf.status === WorkflowStatus.CREATED) {
      wf.start(this._clock.now(), { actor: input.actor, correlationId: input.correlationId });
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

    const response = {
      workflowId: wf.id,
      status: wf.status,
      stoppedReason: result.stoppedReason,
      ranSteps: result.ranSteps,
    };
    if (input.idempotencyKey && this._idempotency) {
      await this._idempotency.put(
        {
          actor: input.actor.id,
          route: `execute_workflow:${input.workflowId}`,
          key: input.idempotencyKey,
        },
        { bodyHash: input.workflowId, response },
      );
    }
    return response;
  }
}
