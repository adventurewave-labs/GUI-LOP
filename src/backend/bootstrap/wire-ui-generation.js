/**
 * wire-ui-generation.js — composition for the UI Generation context.
 *
 * Selects the AI provider adapter (ADR 0023) based on `config.AI_PROVIDER`:
 *   - `stub`     : default, no API key required.
 *   - `openai`   : OpenAI Chat Completions adapter.
 *   - `anthropic`: Anthropic Messages adapter (claude-haiku-4-5 by default).
 *
 * When a real vendor is selected and `AI_API_KEY` is missing, the wiring
 * fails fast at bootstrap. The chosen adapter inherits retry, circuit-
 * breaker, telemetry, and PII-scrubbing from `BaseAIAdapter`.
 */
import { InMemoryUIDocumentRepository } from '../contexts/ui-generation/infrastructure/persistence/inmemory-ui-document-repository.js';
import { InMemoryComponentCatalogueRepository } from '../contexts/ui-generation/infrastructure/persistence/inmemory-component-catalogue-repository.js';
import { PgUIDocumentRepository } from '../contexts/ui-generation/infrastructure/persistence/pg-ui-document-repository.js';
import { InMemoryStorage } from '../contexts/ui-generation/infrastructure/storage/inmemory-storage.js';
import { LocalFsStorage } from '../contexts/ui-generation/infrastructure/storage/local-fs-storage.js';

import { GenerateUIForStepCommand } from '../contexts/ui-generation/application/commands/generate-ui-for-step.js';
import { GetUIDocumentQuery } from '../contexts/ui-generation/application/queries/get-ui-document.js';
import { ListUIComponentsQuery } from '../contexts/ui-generation/application/queries/list-ui-components.js';
import { AIProviderClassificationService } from '../contexts/ui-generation/application/ports/classification-service.js';

import { StubAIProvider } from '../contexts/ui-generation/infrastructure/ai/stub/stub-provider.js';
import { OpenAIProvider } from '../contexts/ui-generation/infrastructure/ai/openai/openai-provider.js';
import { AnthropicProvider } from '../contexts/ui-generation/infrastructure/ai/anthropic/anthropic-provider.js';

import { createUIRouter } from '../contexts/ui-generation/interfaces/http/ui-router.js';

/**
 * Build the configured AIProvider adapter or throw fast on misconfiguration.
 * @param {object} config
 * @param {object} [logger]
 */
export function buildAIProvider(config, logger) {
  const providerName = config?.AI_PROVIDER ?? 'stub';
  const retry = {
    maxRetries: config?.AI_MAX_RETRIES ?? 2,
    timeoutMs: config?.AI_TIMEOUT_MS ?? 30000,
  };
  const common = {
    logger,
    retry,
    baseUrl: config?.AI_BASE_URL || undefined,
    model: config?.AI_MODEL || undefined,
    apiKey: config?.AI_API_KEY || undefined,
  };

  if (providerName === 'stub') {
    return new StubAIProvider({ logger });
  }
  if (!common.apiKey) {
    throw new Error(
      `AI_PROVIDER=${providerName} requires AI_API_KEY to be set in the environment.`,
    );
  }
  if (providerName === 'openai') return new OpenAIProvider(common);
  if (providerName === 'anthropic') return new AnthropicProvider(common);
  throw new Error(`Unknown AI_PROVIDER: ${providerName}`);
}

export function wireUIGeneration({
  pool,
  clock,
  idGen,
  storageMode = 'in-memory',
  logger,
  config,
}) {
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

  // AI provider ACL — selects vendor by config.AI_PROVIDER; defaults to stub.
  const aiProvider = config ? buildAIProvider(config, logger) : new StubAIProvider({ logger });
  const classificationService = new AIProviderClassificationService({ aiProvider });

  const useCases = {
    generateUIForStep: new GenerateUIForStepCommand({
      uiDocumentRepository,
      componentCatalogueRepository,
      objectStorage,
      clock,
      idGenerator: idGen,
      domainEventSink,
      aiProvider,
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
      `ui-generation wired (${pool ? 'pg' : 'in-memory'} repo, ${storageMode} storage, ai=${aiProvider.name})`,
    );
  }

  return {
    useCases,
    router,
    repositories: { uiDocumentRepository, componentCatalogueRepository },
    objectStorage,
    domainEventSink,
    aiProvider,
    classificationService,
  };
}
