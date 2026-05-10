import { InvalidStateTransitionError, StepNotFoundError } from '../../domain/errors.js';
import { Workflow } from '../../domain/workflow/workflow.js';
import { WorkflowStatus } from '../../domain/workflow/workflow-status.js';
import {
  autoThenHumanTemplate,
  makeClock,
  makeIds,
  makeWorkflow,
  singleAutomatedTemplate,
} from '../helpers/test-fixtures.js';

describe('Workflow aggregate', () => {
  let clock;
  let ids;

  beforeEach(() => {
    clock = makeClock();
    ids = makeIds('wf');
  });

  describe('createFromTemplate', () => {
    it('creates a workflow with one step per template step', () => {
      const tmpl = singleAutomatedTemplate(clock.now());
      const wf = makeWorkflow(tmpl, clock.now(), ids);
      expect(wf.status).toBe(WorkflowStatus.CREATED);
      expect(wf.steps).toHaveLength(1);
      expect(wf.steps[0].name).toBe('Echo');
      expect(wf.steps[0].status).toBe(WorkflowStatus.CREATED);
    });

    it('emits workflow.created on creation', () => {
      const tmpl = singleAutomatedTemplate(clock.now());
      const wf = makeWorkflow(tmpl, clock.now(), ids);
      const events = wf.pullEvents();
      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe('workflow_orchestration.workflow.created');
    });

    it('rejects empty template', () => {
      const fakeTmpl = { key: { value: 'x' }, version: { value: 1 }, steps: [] };
      expect(() => makeWorkflow(fakeTmpl, clock.now(), ids)).toThrow();
    });
  });

  describe('start', () => {
    it('transitions created -> running and emits started', () => {
      const tmpl = singleAutomatedTemplate(clock.now());
      const wf = makeWorkflow(tmpl, clock.now(), ids);
      wf.pullEvents();
      const events = wf.start(clock.now());
      expect(wf.status).toBe(WorkflowStatus.RUNNING);
      expect(wf.startedAt).toBeInstanceOf(Date);
      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe('workflow_orchestration.workflow.started');
    });

    it('is idempotent if already running', () => {
      const tmpl = singleAutomatedTemplate(clock.now());
      const wf = makeWorkflow(tmpl, clock.now(), ids);
      wf.start(clock.now());
      wf.pullEvents();
      const events = wf.start(clock.now());
      expect(events).toEqual([]);
    });
  });

  describe('beginStep / recordStepOutput', () => {
    it('runs an automated step end-to-end and completes the workflow', () => {
      const tmpl = singleAutomatedTemplate(clock.now());
      const wf = makeWorkflow(tmpl, clock.now(), ids);
      wf.pullEvents();
      wf.start(clock.now());
      const [step] = wf.steps;
      wf.beginStep(step.id, clock.now());
      wf.recordStepOutput(step.id, { hello: 'world' }, clock.now());
      expect(wf.status).toBe(WorkflowStatus.COMPLETED);
      expect(wf.completedAt).toBeInstanceOf(Date);
      const types = wf.pullEvents().map((e) => e.eventType);
      expect(types).toEqual(expect.arrayContaining([
        'workflow_orchestration.workflow.started',
        'workflow_orchestration.workflow.step_started',
        'workflow_orchestration.workflow.step_completed',
        'workflow_orchestration.workflow.completed',
      ]));
    });

    it('refuses recordStepOutput when workflow not running', () => {
      const tmpl = singleAutomatedTemplate(clock.now());
      const wf = makeWorkflow(tmpl, clock.now(), ids);
      const step = wf.steps[0];
      expect(() => wf.recordStepOutput(step.id, {}, clock.now()))
        .toThrow(InvalidStateTransitionError);
    });

    it('throws StepNotFoundError for unknown step ids', () => {
      const tmpl = singleAutomatedTemplate(clock.now());
      const wf = makeWorkflow(tmpl, clock.now(), ids);
      wf.start(clock.now());
      expect(() => wf.beginStep('does-not-exist', clock.now()))
        .toThrow(StepNotFoundError);
    });
  });

  describe('human input', () => {
    it('pauses on human step and resumes via applyHumanResponse', () => {
      const tmpl = autoThenHumanTemplate(clock.now());
      const wf = makeWorkflow(tmpl, clock.now(), ids);
      wf.pullEvents();
      wf.start(clock.now());
      const [auto, human] = wf.steps;
      wf.beginStep(auto.id, clock.now());
      wf.recordStepOutput(auto.id, { result: 1 }, clock.now());
      // Now human step pending; mark waiting.
      wf.markStepWaitingForHuman(human.id, { form: 'go' }, clock.now());
      expect(wf.status).toBe(WorkflowStatus.WAITING_FOR_HUMAN);
      wf.pullEvents();
      // Apply human response.
      wf.applyHumanResponse(human.id, { action: 'approve' }, clock.now());
      expect(wf.status).toBe(WorkflowStatus.COMPLETED);
      const types = wf.pullEvents().map((e) => e.eventType);
      expect(types).toEqual(expect.arrayContaining([
        'workflow_orchestration.workflow.step_completed',
        'workflow_orchestration.workflow.completed',
      ]));
    });

    it('refuses applyHumanResponse when not waiting', () => {
      const tmpl = autoThenHumanTemplate(clock.now());
      const wf = makeWorkflow(tmpl, clock.now(), ids);
      wf.start(clock.now());
      const human = wf.steps[1];
      expect(() => wf.applyHumanResponse(human.id, {}, clock.now()))
        .toThrow(InvalidStateTransitionError);
    });
  });

  describe('cancel and fail', () => {
    it('cancels a created workflow and cascades', () => {
      const tmpl = autoThenHumanTemplate(clock.now());
      const wf = makeWorkflow(tmpl, clock.now(), ids);
      wf.pullEvents();
      const events = wf.cancel('user-1', 'no longer needed', clock.now());
      expect(wf.status).toBe(WorkflowStatus.CANCELLED);
      expect(wf.steps.every((s) => s.isCancelled() || s.isTerminal())).toBe(true);
      expect(events[0].eventType).toBe('workflow_orchestration.workflow.cancelled');
    });

    it('fail emits workflow.failed and refuses second transition', () => {
      const tmpl = singleAutomatedTemplate(clock.now());
      const wf = makeWorkflow(tmpl, clock.now(), ids);
      wf.start(clock.now());
      wf.pullEvents();
      wf.fail('boom', clock.now());
      expect(wf.status).toBe(WorkflowStatus.FAILED);
      // already terminal
      expect(wf.fail('again', clock.now())).toEqual([]);
    });

    it('failStep cascades to workflow', () => {
      const tmpl = singleAutomatedTemplate(clock.now());
      const wf = makeWorkflow(tmpl, clock.now(), ids);
      wf.start(clock.now());
      wf.pullEvents();
      const [step] = wf.steps;
      wf.beginStep(step.id, clock.now());
      const events = wf.failStep(step.id, new Error('nope'), clock.now());
      expect(wf.status).toBe(WorkflowStatus.FAILED);
      const types = events.map((e) => e.eventType);
      expect(types).toEqual(expect.arrayContaining([
        'workflow_orchestration.workflow.step_failed',
        'workflow_orchestration.workflow.failed',
      ]));
    });
  });

  describe('nextAction()', () => {
    it('returns Idle for created', () => {
      const tmpl = singleAutomatedTemplate(clock.now());
      const wf = makeWorkflow(tmpl, clock.now(), ids);
      const a = wf.nextAction();
      expect(a.type).toBe('Idle');
    });

    it('returns Advance for running automated', () => {
      const tmpl = singleAutomatedTemplate(clock.now());
      const wf = makeWorkflow(tmpl, clock.now(), ids);
      wf.start(clock.now());
      const a = wf.nextAction();
      expect(a.type).toBe('AdvanceToNextStep');
    });

    it('returns PauseForHumanInput when next step is human', () => {
      const tmpl = autoThenHumanTemplate(clock.now());
      const wf = makeWorkflow(tmpl, clock.now(), ids);
      wf.start(clock.now());
      const auto = wf.steps[0];
      wf.beginStep(auto.id, clock.now());
      wf.recordStepOutput(auto.id, {}, clock.now());
      const a = wf.nextAction();
      expect(a.type).toBe('PauseForHumanInput');
    });

    it('returns Idle when waiting for human', () => {
      const tmpl = autoThenHumanTemplate(clock.now());
      const wf = makeWorkflow(tmpl, clock.now(), ids);
      wf.start(clock.now());
      const auto = wf.steps[0];
      const human = wf.steps[1];
      wf.beginStep(auto.id, clock.now());
      wf.recordStepOutput(auto.id, {}, clock.now());
      wf.markStepWaitingForHuman(human.id, {}, clock.now());
      const a = wf.nextAction();
      expect(a.type).toBe('Idle');
    });
  });

  describe('rehydrate', () => {
    it('round-trips through toState/rehydrate', () => {
      const tmpl = autoThenHumanTemplate(clock.now());
      const wf = makeWorkflow(tmpl, clock.now(), ids);
      wf.start(clock.now());
      wf.pullEvents();
      const snapshot = wf.toState();
      const rehydrated = Workflow.rehydrate(snapshot);
      expect(rehydrated.status).toBe(wf.status);
      expect(rehydrated.steps).toHaveLength(wf.steps.length);
      expect(rehydrated.id).toBe(wf.id);
    });
  });
});
