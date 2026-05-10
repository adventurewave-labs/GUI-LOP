/**
 * UI Generation context — application tests with in-memory adapters.
 */

import { GenerateUIForStepCommand } from '../../../../src/backend/contexts/ui-generation/application/commands/generate-ui-for-step.js';
import { GetUIDocumentQuery } from '../../../../src/backend/contexts/ui-generation/application/queries/get-ui-document.js';
import { ListUIComponentsQuery } from '../../../../src/backend/contexts/ui-generation/application/queries/list-ui-components.js';

import { InMemoryUIDocumentRepository } from '../../../../src/backend/contexts/ui-generation/infrastructure/persistence/inmemory-ui-document-repository.js';
import { InMemoryComponentCatalogueRepository } from '../../../../src/backend/contexts/ui-generation/infrastructure/persistence/inmemory-component-catalogue-repository.js';
import { InMemoryStorage } from '../../../../src/backend/contexts/ui-generation/infrastructure/storage/inmemory-storage.js';
import { FrozenClock, FixedIdGenerator } from '../../../../src/backend/shared/kernel/index.js';

function makeStack() {
  const docs = new InMemoryUIDocumentRepository();
  const catalogue = new InMemoryComponentCatalogueRepository();
  const storage = new InMemoryStorage();
  const clock = new FrozenClock(new Date('2026-05-10T00:00:00.000Z'));
  const ids = new FixedIdGenerator(['spec-1', 'doc-1']);
  const sink = { events: [], append: async (e) => sink.events.push(e) };

  const cmd = new GenerateUIForStepCommand({
    uiDocumentRepository: docs,
    componentCatalogueRepository: catalogue,
    objectStorage: storage,
    clock,
    idGenerator: ids,
    domainEventSink: sink
  });
  return { docs, catalogue, storage, clock, ids, sink, cmd };
}

describe('GenerateUIForStep', () => {
  it('produces a UIDocument and stores its content', async () => {
    const { cmd, docs, storage, sink } = makeStack();
    const out = await cmd.execute({
      workflowId: 'wf-1',
      stepId: 'step-1',
      title: 'Step 1',
      fields: [
        { id: 'name', label: 'Name', type: 'text' },
        { id: 'age', label: 'Age', type: 'number' }
      ]
    });
    expect(out.isOk).toBe(true);
    expect(docs.size()).toBe(1);
    expect(storage.size()).toBe(1);
    expect(out.value.url).toMatch(/^\/ui-documents\/ui\/wf-1\/step-1\/doc-1\.json$/);
    expect(sink.events.find((e) => e.type === 'ui.generated')).toBeTruthy();
  });

  it('emits UIGenerationFailed and returns Result.fail on validation error', async () => {
    const { cmd, sink } = makeStack();
    const out = await cmd.execute({
      workflowId: 'wf-1',
      stepId: 'step-1',
      fields: [
        { id: 'a', label: 'A', type: 'text' },
        { id: 'a', label: 'B', type: 'text' }
      ]
    });
    expect(out.isFail).toBe(true);
    expect(sink.events.find((e) => e.type === 'ui.generation_failed')).toBeTruthy();
  });
});

describe('GetUIDocument query', () => {
  it('returns null for unknown ids', async () => {
    const { docs } = makeStack();
    const q = new GetUIDocumentQuery({ uiDocumentRepository: docs });
    expect(await q.execute({ id: 'missing' })).toBeNull();
  });
});

describe('ListUIComponents query', () => {
  it('returns the seeded catalogue', async () => {
    const { catalogue } = makeStack();
    const q = new ListUIComponentsQuery({ componentCatalogueRepository: catalogue });
    const list = await q.execute();
    const names = list.map((c) => c.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'text-input', 'select', 'textarea', 'boolean-checkbox',
        'date-picker', 'submit-button', 'dashboard-card'
      ])
    );
  });
});
