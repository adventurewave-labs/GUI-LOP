/**
 * Unit test: InMemoryWorkflowRepository forwards aggregate events to an
 * eventSink when one is wired (used by the bootstrap `forwardWorkflowEvents`
 * hook in dev/in-memory mode).
 */

import { InMemoryWorkflowRepository } from '../../infrastructure/persistence/inmemory-workflow-repository.js';
import { Workflow } from '../../domain/workflow/workflow.js';

function makeTemplate() {
  return {
    key: { value: 'data-analysis' },
    version: { value: 1 },
    steps: [
      { id: 's1', name: 'collect', kind: 'automated', order: 1, toJSON() { return this; } },
    ],
    findStep(id) { return this.steps.find((s) => s.id === id); },
  };
}

describe('InMemoryWorkflowRepository event sink', () => {
  test('forwards events to the sink after save() completes', async () => {
    const sink = { append: jest.fn(async () => {}) };
    const repo = new InMemoryWorkflowRepository({ eventSink: sink });
    const wf = Workflow.createFromTemplate({
      id: 'wf-1',
      template: makeTemplate(),
      context: {},
      createdBy: 'tester',
      now: new Date(),
      stepIdGen: { next: () => 'step-1' },
    });
    await repo.save(wf);
    expect(sink.append).toHaveBeenCalledTimes(1);
    const events = sink.append.mock.calls[0][0];
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].eventType).toBe('workflow_orchestration.workflow.created');
  });

  test('setEventSink swaps the sink at runtime', async () => {
    const repo = new InMemoryWorkflowRepository();
    const sink = { append: jest.fn(async () => {}) };
    repo.setEventSink(sink);
    const wf = Workflow.createFromTemplate({
      id: 'wf-2',
      template: makeTemplate(),
      context: {},
      createdBy: 'tester',
      now: new Date(),
      stepIdGen: { next: () => 'step-1' },
    });
    await repo.save(wf);
    expect(sink.append).toHaveBeenCalledTimes(1);
  });

  test('save() succeeds without a sink (noop forwarding)', async () => {
    const repo = new InMemoryWorkflowRepository();
    const wf = Workflow.createFromTemplate({
      id: 'wf-3',
      template: makeTemplate(),
      context: {},
      createdBy: 'tester',
      now: new Date(),
      stepIdGen: { next: () => 'step-1' },
    });
    await expect(repo.save(wf)).resolves.toBeUndefined();
    expect(repo.publishedEvents.length).toBeGreaterThan(0);
  });
});
