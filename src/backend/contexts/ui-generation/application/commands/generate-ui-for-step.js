/**
 * GenerateUIForStep — implements the cross-context port that
 * Workflow Orchestration calls when a step is reached and a UI is needed.
 *
 * Flow:
 *   1. Build a UISpecification (validating field/component/validation refs).
 *   2. Pick a generation strategy.
 *   3. Compose layout and resolve components via pure domain services.
 *   4. Persist content to object storage; persist a UIDocument aggregate.
 *   5. Emit UIGenerated (or UIGenerationFailed).
 */

import { randomUUID } from 'crypto';
import { Result } from '../../../../shared/kernel/result.js';
import { UISpecification } from '../../domain/ui-specification.js';
import { UIDocument } from '../../domain/ui-document.js';
import { compose } from '../../domain/services/layout-composer.js';
import { resolve } from '../../domain/services/component-resolver.js';
import { select } from '../../domain/services/generation-strategy-selector.js';
import { UIGenerated, UIGenerationFailed } from '../../domain/events.js';

export class GenerateUIForStepCommand {
  constructor({
    uiDocumentRepository,
    componentCatalogueRepository,
    objectStorage,
    clock,
    idGenerator,
    domainEventSink
  }) {
    this._docs = uiDocumentRepository;
    this._catalogue = componentCatalogueRepository;
    this._storage = objectStorage;
    this._clock = clock;
    this._ids = idGenerator;
    this._sink = domainEventSink ?? { append: async () => {} };
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
          strategyHint: input.strategyHint
        },
        { catalogue: this._catalogue }
      );

      const strategy = select(spec);
      const layout = compose(spec, { kind: input.layout?.kind });
      const components = spec.fields.map((f) => resolve(f, this._catalogue));

      const docId = this._ids?.next?.() ?? randomUUID();
      const contentRef = `ui/${spec.workflowId}/${spec.stepId}/${docId}.json`;
      const content = JSON.stringify(
        {
          spec: spec.toJSON(),
          layout: layout.toJSON(),
          components,
          strategy
        },
        null,
        2
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
        generatedAt: nowIso
      });
      await this._docs.save(doc);

      await this._sink.append(
        new UIGenerated({
          documentId: doc.id,
          workflowId: doc.workflowId,
          stepId: doc.stepId,
          url: doc.url,
          strategy: doc.strategy,
          occurredAt: nowIso
        })
      );

      return Result.ok(doc);
    } catch (err) {
      await this._sink.append(
        new UIGenerationFailed({
          workflowId: input.workflowId,
          stepId: input.stepId,
          error: err?.message ?? String(err),
          occurredAt: nowIso
        })
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
