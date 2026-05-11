/**
 * generate-ui-for-step.test.js — extra coverage for the AI-routing branch
 * of `GenerateUIForStepCommand`. The deterministic-fallback path is also
 * exercised end-to-end in `tests/backend/contexts/ui-generation/application.test.js`;
 * this file zeroes in on the new AI-provider integration.
 */

import {
  GenerateUIForStepCommand,
  AI_ASSISTED_STRATEGY,
} from '../../application/commands/generate-ui-for-step.js';
import { InMemoryUIDocumentRepository } from '../../infrastructure/persistence/inmemory-ui-document-repository.js';
import { InMemoryComponentCatalogueRepository } from '../../infrastructure/persistence/inmemory-component-catalogue-repository.js';
import { InMemoryStorage } from '../../infrastructure/storage/inmemory-storage.js';
import { StubAIProvider } from '../../infrastructure/ai/stub/stub-provider.js';
import { AIProviderUnavailable } from '../../infrastructure/ai/domain-errors.js';

function buildStack({ aiProvider } = {}) {
  const docs = new InMemoryUIDocumentRepository();
  const catalogue = new InMemoryComponentCatalogueRepository();
  const storage = new InMemoryStorage();
  const ids = (() => {
    let i = 0;
    const seq = ['spec-1', 'doc-1', 'spec-2', 'doc-2'];
    return { next: () => seq[i++] ?? `gen-${i}` };
  })();
  const sink = { events: [], append: async (e) => sink.events.push(e) };
  const clock = { nowIso: () => '2026-05-11T00:00:00.000Z' };
  const cmd = new GenerateUIForStepCommand({
    uiDocumentRepository: docs,
    componentCatalogueRepository: catalogue,
    objectStorage: storage,
    clock,
    idGenerator: ids,
    domainEventSink: sink,
    aiProvider,
  });
  return { docs, storage, sink, cmd };
}

describe('GenerateUIForStepCommand — AI-assisted routing', () => {
  test('uses the provider draft when strategyHint=ai-assisted', async () => {
    const ai = new StubAIProvider();
    const { cmd, docs, storage, sink } = buildStack({ aiProvider: ai });
    const out = await cmd.execute({
      workflowId: 'wf-9',
      stepId: 'step-9',
      strategyHint: AI_ASSISTED_STRATEGY,
      fields: [
        { id: 'name', label: 'Name', type: 'text' },
        { id: 'age', label: 'Age', type: 'number' },
      ],
    });
    expect(out.isOk()).toBe(true);
    expect(ai.calls).toHaveLength(1);
    expect(docs.size()).toBe(1);
    const doc = out.value;
    expect(doc.strategy).toBe(AI_ASSISTED_STRATEGY);
    const stored = await storage.get(doc.contentRef);
    const parsed = JSON.parse(stored);
    expect(parsed.strategy).toBe(AI_ASSISTED_STRATEGY);
    expect(parsed.layout.kind).toBe('form');
    expect(parsed.components.map((c) => c.id)).toEqual(['name', 'age']);
    const evt = sink.events.find((e) => e.eventType === 'ui.generated');
    expect(evt).toBeTruthy();
    expect(evt.payload.strategy).toBe(AI_ASSISTED_STRATEGY);
  });

  test('falls back to deterministic strategy when no aiProvider is wired', async () => {
    const { cmd, sink } = buildStack();
    const out = await cmd.execute({
      workflowId: 'wf-10',
      stepId: 'step-10',
      strategyHint: AI_ASSISTED_STRATEGY,
      fields: [{ id: 'name', label: 'Name', type: 'text' }],
    });
    expect(out.isOk()).toBe(true);
    const evt = sink.events.find((e) => e.eventType === 'ui.generated');
    expect(evt.payload.strategy).not.toBe(AI_ASSISTED_STRATEGY);
  });

  test('falls back to deterministic strategy when hint is not ai-assisted', async () => {
    const ai = new StubAIProvider();
    const { cmd, sink } = buildStack({ aiProvider: ai });
    const out = await cmd.execute({
      workflowId: 'wf-11',
      stepId: 'step-11',
      fields: [{ id: 'name', label: 'Name', type: 'text' }],
    });
    expect(out.isOk()).toBe(true);
    expect(ai.calls).toHaveLength(0);
    const evt = sink.events.find((e) => e.eventType === 'ui.generated');
    expect(evt.payload.strategy).not.toBe(AI_ASSISTED_STRATEGY);
  });

  test('emits ui.generation_failed with the AI error name on provider failure', async () => {
    const failing = {
      async generateUI() { throw new AIProviderUnavailable('upstream down'); },
      async classify() {},
      async healthCheck() {},
    };
    const { cmd, sink } = buildStack({ aiProvider: failing });
    const out = await cmd.execute({
      workflowId: 'wf-12',
      stepId: 'step-12',
      strategyHint: AI_ASSISTED_STRATEGY,
      fields: [{ id: 'name', label: 'Name', type: 'text' }],
    });
    expect(out.isFail()).toBe(true);
    const failed = sink.events.find((e) => e.eventType === 'ui.generation_failed');
    expect(failed).toBeTruthy();
    expect(failed.payload.error).toMatch(/upstream down/);
  });
});
