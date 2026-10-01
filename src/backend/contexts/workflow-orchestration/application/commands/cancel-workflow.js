// @ts-check
import { authoriseWorkflowAction } from '../services/authorise-workflow-action.js';
import { PreconditionFailedError } from '../../../../shared-kernel/domain/errors.js';
import { WorkflowNotFoundError } from '../../domain/errors.js';

export class CancelWorkflowUseCase {
  constructor({ workflows, clock, authorisation }) {
    this._workflows = workflows;
    this._clock = clock;
    this._authorisation = authorisation;
  }

  async execute(input) {
    await authoriseWorkflowAction({
      authorisation: this._authorisation,
      workflows: this._workflows,
      actor: input.actor,
      action: 'workflow:cancel',
      workflowId: input.workflowId,
    });
    const wf = await this._workflows.findById(input.workflowId);
    if (!wf) throw new WorkflowNotFoundError(input.workflowId);
    assertExpectedVersion(wf, input.expectedVersions);
    wf.cancel(input.actor?.id ?? 'system', input.reason ?? null, this._clock.now(), {
      actor: input.actor,
      correlationId: input.correlationId,
    });
    await this._workflows.save(wf);
    return {
      workflowId: wf.id,
      status: wf.status,
      reason: input.reason ?? null,
      version: wf.version,
    };
  }
}

/**
 * If-Match: the caller acted on one of these versions. Checked after the
 * load (not before, in the router) so there is no check-then-act window;
 * the repository's own optimistic lock covers the rest.
 * @param {{ version: number }} wf
 * @param {number[] | undefined} expected
 */
export function assertExpectedVersion(wf, expected) {
  if (expected && !expected.includes(wf.version)) {
    throw new PreconditionFailedError(`Workflow is at version ${wf.version}`, { currentVersion: wf.version });
  }
}
