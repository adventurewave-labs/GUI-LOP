/**
 * wire-ui-generation.js — composition for the UI Generation context.
 */
import { InMemoryUIDocumentRepository } from '../contexts/ui-generation/infrastructure/persistence/inmemory-ui-document-repository.js';
import { InMemoryComponentCatalogueRepository } from '../contexts/ui-generation/infrastructure/persistence/inmemory-component-catalogue-repository.js';
import { PgUIDocumentRepository } from '../contexts/ui-generation/infrastructure/persistence/pg-ui-document-repository.js';
import { InMemoryStorage } from '../contexts/ui-generation/infrastructure/storage/inmemory-storage.js';
import { LocalFsStorage } from '../contexts/ui-generation/infrastructure/storage/local-fs-storage.js';

import { GenerateUIForStepCommand } from '../contexts/ui-generation/application/commands/generate-ui-for-step.js';
import { GetUIDocumentQuery } from '../contexts/ui-generation/application/queries/get-ui-document.js';
import { ListUIComponentsQuery } from '../contexts/ui-generation/application/queries/list-ui-components.js';

import { createUIRouter } from '../contexts/ui-generation/interfaces/http/ui-router.js';

export function wireUIGeneration({ pool, clock, idGen, storageMode = 'in-memory', logger }) {
  const uiDocumentRepository = pool
    ? new PgUIDocumentRepository(pool)
    : new InMemoryUIDocumentRepository();
  const componentCatalogueRepository = new InMemoryComponentCatalogueRepository();
  const objectStorage = storageMode === 'local-fs' ? new LocalFsStorage() : new InMemoryStorage();

  // Tiny sink that just collects emitted events; the bootstrap will replace
  // this with the shared outbox once the publisher is wired.
  const domainEventSink = {
    events: [],
    async append(e) {
      this.events.push(e);
    },
  };

  const useCases = {
    generateUIForStep: new GenerateUIForStepCommand({
      uiDocumentRepository,
      componentCatalogueRepository,
      objectStorage,
      clock,
      idGenerator: idGen,
      domainEventSink,
    }),
    getUIDocument: new GetUIDocumentQuery({ uiDocumentRepository }),
    listUIComponents: new ListUIComponentsQuery({ componentCatalogueRepository }),
  };

  const router = createUIRouter({
    generateUIForStepCommand: useCases.generateUIForStep,
    getUIDocumentQuery: useCases.getUIDocument,
    listUIComponentsQuery: useCases.listUIComponents,
  });

  if (logger) {
    logger.info(
      `ui-generation wired (${pool ? 'pg' : 'in-memory'} repo, ${storageMode} storage)`,
    );
  }

  return {
    useCases,
    router,
    repositories: { uiDocumentRepository, componentCatalogueRepository },
    objectStorage,
    domainEventSink,
  };
}
