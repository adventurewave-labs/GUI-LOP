/**
 * GenerateUIForStep — implements the cross-context port that
 * Workflow Orchestration calls when a step is reached and a UI is needed.
 *
 * Flow:
 *   1. Build a UISpecification (validating field/component/validation refs).
 *   2. Pick a generation strategy.
 *   3. If `aiProvider` is supplied AND the spec carries
 *      `strategyHint: 'ai-assisted'`, delegate to the provider to produce a
 *      draft layout + fields, and stamp the document with the `ai-assisted`
 *      strategy. Otherwise fall back to the deterministic LayoutComposer
 *      flow with the strategy chosen by `generation-strategy-selector`.
 *   4. Persist content to object storage; persist a UIDocument aggregate.
 *   5. Emit `ui.generated` (or `ui.generation_failed`).
 *
 * The `ai-assisted` strategy is opt-in. When the AI route is taken and the
 * provider throws, the failure event records the AI domain error class
 * name as the `reason` so subscribers can react differently to a
 * `AIQuotaExceeded` versus a `ValidationError`.
 */

import { randomUUID } from 'crypto';
import { Result } from '../../../../shared-kernel/domain/result.js';
import { UISpecification } from '../../domain/ui-specification.js';
import { UIDocument } from '../../domain/ui-document.js';
import { compose } from '../../domain/services/layout-composer.js';
import { resolve } from '../../domain/services/component-resolver.js';
import { select } from '../../domain/services/generation-strategy-selector.js';
import { UIGenerated, UIGenerationFailed } from '../../domain/events.js';

export const AI_ASSISTED_STRATEGY = 'ai-assisted';

export class GenerateUIForStepCommand {
  constructor({
    uiDocumentRepository,
    componentCatalogueRepository,
    objectStorage,
    clock,
    idGenerator,
    domainEventSink,
    aiProvider,
  }) {
    this._docs = uiDocumentRepository;
    this._catalogue = componentCatalogueRepository;
    this._storage = objectStorage;
    this._clock = clock;
    this._ids = idGenerator;
    this._sink = domainEventSink ?? { append: async () => {} };
    this._ai = aiProvider ?? null;
  }

  async execute(input) {
    const nowIso = this._nowIso();
    try {
      const spec = UISpecification.create(
        {
          id: this._ids?.next?.() ?? randomUUID(),
          workflowId: input.workflowId,
          stepId: input.stepId,
          title: input.title,
          fields: input.fields ?? [],
          layout: input.layout,
          strategyHint: input.strategyHint,
        },
        { catalogue: this._catalogue },
      );

      const useAi = !!this._ai && input.strategyHint === AI_ASSISTED_STRATEGY;
      let strategy;
      let layout;
      let components;
      let aiDraft = null;

      if (useAi) {
        aiDraft = await this._ai.generateUI({
          spec: spec.toJSON(),
          context: input.context ?? {},
          strategyHints: input.strategyHints ?? null,
        });
        strategy = AI_ASSISTED_STRATEGY;
        layout = aiDraft.layout;
        components = aiDraft.fields;
      } else {
        strategy = select(spec);
        layout = compose(spec, { kind: input.layout?.kind }).toJSON();
        components = spec.fields.map((f) => resolve(f, this._catalogue));
      }

      const docId = this._ids?.next?.() ?? randomUUID();
      const contentRef = `ui/${spec.workflowId}/${spec.stepId}/${docId}.json`;
      const content = JSON.stringify(
        {
          spec: spec.toJSON(),
          layout,
          components,
          strategy,
          ...(aiDraft?.rationale ? { rationale: aiDraft.rationale } : {}),
          ...(aiDraft?.tokenUsage ? { tokenUsage: aiDraft.tokenUsage } : {}),
        },
        null,
        2,
      );

      await this._storage.put(contentRef, content);
      const url = this._storage.getUrl(contentRef);

      const doc = new UIDocument({
        id: docId,
        workflowId: spec.workflowId,
        stepId: spec.stepId,
        url,
        contentRef,
        strategy,
        version: 1,
        generatedAt: nowIso,
      });
      await this._docs.save(doc);

      await this._sink.append(
        new UIGenerated({
          documentId: doc.id,
          workflowId: doc.workflowId,
          stepId: doc.stepId,
          url: doc.url,
          strategy: doc.strategy,
          occurredAt: nowIso,
        }),
      );

      return Result.ok(doc);
    } catch (err) {
      await this._sink.append(
        new UIGenerationFailed({
          workflowId: input.workflowId,
          stepId: input.stepId,
          error: err?.message ?? String(err),
          reason: err?.name ?? 'Error',
          occurredAt: nowIso,
        }),
      );
      return Result.fail(err);
    }
  }

  _nowIso() {
    if (this._clock?.nowIso) return this._clock.nowIso();
    if (this._clock?.now) return new Date(this._clock.now()).toISOString();
    return new Date().toISOString();
  }
}
