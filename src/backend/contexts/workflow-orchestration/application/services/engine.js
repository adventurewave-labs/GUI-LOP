import { EngineActionType } from '../../domain/workflow/workflow-execution-policy.js';
import {
  validateInput,
  validateOutput,
} from '../../domain/workflow/step-validation-service.js';

/**
 * Engine — pure orchestration over a Workflow aggregate.
 *
 * Determinism: given a frozen `clock`, the engine produces the same
 * sequence of events for the same inputs.
 */
export class WorkflowEngine {
  constructor({
    clock,
    automatedRunner,
    externalRunner,
    uiGeneration,
    templateLookup,
    maxSteps = 100,
    actor,
  }) {
    if (!clock) throw new Error('Engine requires a Clock');
    this._clock = clock;
    this._automated = automatedRunner;
    this._external = externalRunner;
    this._ui = uiGeneration;
    this._templateLookup = templateLookup;
    this._maxSteps = maxSteps;
    this._actor = actor;
  }

  async run(workflow) {
    let ranSteps = 0;
    while (ranSteps < this._maxSteps) {
      const action = workflow.nextAction();
      switch (action.type) {
        case EngineActionType.IDLE:
          return { stoppedReason: action.reason ?? 'idle', ranSteps };
        case EngineActionType.COMPLETE:
          return { stoppedReason: 'completed', ranSteps };
        case EngineActionType.FAIL: {
          workflow.fail(
            action.reason ?? 'engine_fail',
            this._clock.now(),
            { actor: this._actor },
          );
          return { stoppedReason: 'failed', ranSteps };
        }
        case EngineActionType.ADVANCE: {
          await this._runAutomated(workflow, action.step);
          ranSteps += 1;
          break;
        }
        case EngineActionType.INVOKE_EXTERNAL: {
          const stop = await this._runExternal(workflow, action.step);
          ranSteps += 1;
          if (stop) return { stoppedReason: 'external_deferred', ranSteps };
          break;
        }
        case EngineActionType.PAUSE_HUMAN: {
          await this._pauseHuman(workflow, action.step);
          return { stoppedReason: 'waiting_for_human', ranSteps };
        }
        default:
          return { stoppedReason: `unknown_action:${action.type}`, ranSteps };
      }
    }
    return { stoppedReason: 'max_steps', ranSteps };
  }

  async _stepDefinitionFor(workflow, step) {
    if (!this._templateLookup) return null;
    const tmpl = await this._templateLookup(workflow.templateKey, workflow.templateVersion);
    if (!tmpl) return null;
    return tmpl.steps.find((s) => s.name === step.name) ?? null;
  }

  async _runAutomated(workflow, step) {
    const now = this._clock.now();
    workflow.beginStep(step.id, now, { actor: this._actor });
    if (!this._automated) {
      workflow.failStep(step.id, new Error('no_automated_runner'), this._clock.now(), { actor: this._actor });
      return;
    }
    const def = await this._stepDefinitionFor(workflow, step);
    try {
      if (def) validateInput(def, workflow.context.toJSON());
      const result = await this._automated.run({
        workflow,
        step,
        context: workflow.context.toJSON(),
      });
      if (result?.error) {
        workflow.failStep(step.id, result.error, this._clock.now(), { actor: this._actor });
        return;
      }
      const output = result?.output ?? {};
      if (def) validateOutput(def, output);
      workflow.recordStepOutput(step.id, output, this._clock.now(), { actor: this._actor });
    } catch (err) {
      workflow.failStep(step.id, err, this._clock.now(), { actor: this._actor });
    }
  }

  async _runExternal(workflow, step) {
    const now = this._clock.now();
    workflow.beginStep(step.id, now, { actor: this._actor });
    if (!this._external) {
      workflow.failStep(step.id, new Error('no_external_runner'), this._clock.now(), { actor: this._actor });
      return false;
    }
    const def = await this._stepDefinitionFor(workflow, step);
    try {
      const result = await this._external.run({
        workflow,
        step,
        context: workflow.context.toJSON(),
      });
      if (result?.deferred) return true;
      if (result?.error) {
        workflow.failStep(step.id, result.error, this._clock.now(), { actor: this._actor });
        return false;
      }
      const output = result?.output ?? {};
      if (def) validateOutput(def, output);
      workflow.recordStepOutput(step.id, output, this._clock.now(), { actor: this._actor });
      return false;
    } catch (err) {
      workflow.failStep(step.id, err, this._clock.now(), { actor: this._actor });
      return false;
    }
  }

  async _pauseHuman(workflow, step) {
    let uiSpec = step.uiSpec;
    if (this._ui) {
      try {
        const out = await this._ui.generateForStep({
          workflowId: workflow.id,
          stepId: step.id,
          uiSpec,
          context: workflow.context.toJSON(),
        });
        if (out?.url) uiSpec = { ...(uiSpec ?? {}), url: out.url };
      } catch (_) {
        // best-effort
      }
    }
    workflow.markStepWaitingForHuman(step.id, uiSpec, this._clock.now(), { actor: this._actor });
  }
}
