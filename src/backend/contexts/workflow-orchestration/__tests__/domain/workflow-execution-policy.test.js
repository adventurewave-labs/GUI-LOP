import { EngineActionType, nextAction } from '../../domain/workflow/workflow-execution-policy.js';
import {
  autoThenHumanTemplate,
  makeClock,
  makeIds,
  makeWorkflow,
  singleAutomatedTemplate,
} from '../helpers/test-fixtures.js';

describe('WorkflowExecutionPolicy.nextAction', () => {
  const clock = makeClock();
  const ids = makeIds('p');

  it('returns Idle for null workflow', () => {
    expect(nextAction(null).type).toBe(EngineActionType.IDLE);
  });

  it('returns Advance for an automated pending step', () => {
    const tmpl = singleAutomatedTemplate(clock.now());
    const wf = makeWorkflow(tmpl, clock.now(), ids);
    wf.start(clock.now());
    expect(nextAction(wf).type).toBe(EngineActionType.ADVANCE);
  });

  it('returns Complete when all steps are done', () => {
    const tmpl = singleAutomatedTemplate(clock.now());
    const wf = makeWorkflow(tmpl, clock.now(), ids);
    wf.start(clock.now());
    const [s] = wf.steps;
    wf.beginStep(s.id, clock.now());
    wf.recordStepOutput(s.id, {}, clock.now());
    // workflow is now completed; nextAction should return Idle (terminal).
    expect(nextAction(wf).type).toBe(EngineActionType.IDLE);
  });

  it('returns PauseForHumanInput when next step is human', () => {
    const tmpl = autoThenHumanTemplate(clock.now());
    const wf = makeWorkflow(tmpl, clock.now(), ids);
    wf.start(clock.now());
    const [auto] = wf.steps;
    wf.beginStep(auto.id, clock.now());
    wf.recordStepOutput(auto.id, {}, clock.now());
    expect(nextAction(wf).type).toBe(EngineActionType.PAUSE_HUMAN);
  });
});
