/**
 * wire-workflow-orchestration.js — composition for the Workflow context.
 */
import { InMemoryWorkflowRepository } from '../contexts/workflow-orchestration/infrastructure/persistence/inmemory-workflow-repository.js';
import { InMemoryWorkflowTemplateRepository } from '../contexts/workflow-orchestration/infrastructure/persistence/inmemory-workflow-template-repository.js';
import { PgWorkflowRepository } from '../contexts/workflow-orchestration/infrastructure/persistence/pg-workflow-repository.js';
import { PgWorkflowTemplateRepository } from '../contexts/workflow-orchestration/infrastructure/persistence/pg-workflow-template-repository.js';
import { CachedWorkflowTemplateRepository } from '../contexts/workflow-orchestration/infrastructure/persistence/cached-workflow-template-repository.js';
import { StubAutomatedStepRunner } from '../contexts/workflow-orchestration/infrastructure/step-runners/automated-step-runner.js';
import { StubExternalStepRunner } from '../contexts/workflow-orchestration/infrastructure/step-runners/external-step-runner.js';
import { InMemoryIdempotencyStore } from '../contexts/workflow-orchestration/application/ports/idempotency-store.js';

import { PublishWorkflowTemplateUseCase } from '../contexts/workflow-orchestration/application/commands/publish-workflow-template.js';
import { DeprecateWorkflowTemplateUseCase } from '../contexts/workflow-orchestration/application/commands/deprecate-workflow-template.js';
import { CreateWorkflowUseCase } from '../contexts/workflow-orchestration/application/commands/create-workflow.js';
import { ExecuteWorkflowUseCase } from '../contexts/workflow-orchestration/application/commands/execute-workflow.js';
import { CancelWorkflowUseCase } from '../contexts/workflow-orchestration/application/commands/cancel-workflow.js';
import { AdvanceWorkflowUseCase } from '../contexts/workflow-orchestration/application/commands/advance-workflow.js';
import { ListWorkflowTemplatesQuery } from '../contexts/workflow-orchestration/application/queries/list-workflow-templates.js';
import { GetWorkflowTemplateQuery } from '../contexts/workflow-orchestration/application/queries/get-workflow-template.js';
import { GetWorkflowDetailQuery } from '../contexts/workflow-orchestration/application/queries/get-workflow-detail.js';
import { ListActiveWorkflowsQuery } from '../contexts/workflow-orchestration/application/queries/list-active-workflows.js';

import { createWorkflowRouter } from '../contexts/workflow-orchestration/interfaces/http/workflow-router.js';
import { createLegacyWorkflowRouter } from '../contexts/workflow-orchestration/interfaces/http/legacy-router.js';

import { seedDefaultTemplates } from '../../../database/seeds/workflow-templates.js';

/**
 * Adapter that bridges the Workflow context's `AuthorisationService` port
 * (`{ authorise({ actor, action, resource }) -> { allowed, reason } }`) to
 * the Identity & Access service (`ensure({ userId, permission, scope })`).
 */
class IdentityAuthorisationAdapter {
  constructor(identityAuth) {
    this._auth = identityAuth;
  }
  async authorise({ actor, action, resource }) {
    if (!actor || !actor.id) return { allowed: false, reason: 'no_actor' };
    if (!this._auth) return { allowed: true };
    try {
      await this._auth.ensure({
        userId: actor.id,
        permission: action,
        scope: resource?.id ?? null,
      });
      return { allowed: true };
    } catch (err) {
      return { allowed: false, reason: err?.message ?? 'forbidden' };
    }
  }
}

/**
 * Adapter that fulfils the Workflow context's `UIGenerationService` port by
 * delegating to the UI Generation context's `GenerateUIForStep` use case.
 */
class UIGenerationAdapter {
  constructor(generateUIForStepCommand) {
    this._cmd = generateUIForStepCommand;
  }
  async generateForStep({ workflowId, stepId, uiSpec, context }) {
    if (!this._cmd) {
      return { uiDocumentId: `ui-${workflowId}-${stepId}`, url: `/ui/${workflowId}/${stepId}` };
    }
    const out = await this._cmd.execute({
      workflowId,
      stepId,
      title: uiSpec?.title,
      fields: uiSpec?.fields ?? [],
      layout: uiSpec?.layout,
      strategyHint: uiSpec?.strategyHint,
      context,
    });
    if (out.isFail()) {
      // Fall back to a placeholder so the workflow can pause; the failure
      // is already emitted as a UIGenerationFailed domain event.
      return { uiDocumentId: null, url: null, error: out.error?.message };
    }
    const doc = out.value;
    return { uiDocumentId: doc.id, url: doc.url };
  }
}

export async function wireWorkflowOrchestration({
  pool,
  outbox,
  clock,
  idGen,
  identityAuthorisationService,
  generateUIForStepCommand,
  logger,
}) {
  const workflows = pool
    ? new PgWorkflowRepository({ pool, outbox })
    : new InMemoryWorkflowRepository();
  const templatesDelegate = pool
    ? new PgWorkflowTemplateRepository({ pool, outbox })
    : new InMemoryWorkflowTemplateRepository();
  // Hot read decorator. Workflow templates are read on every CreateWorkflow
  // and change at human tempo, so a 60s LRU+TTL cache strips a Postgres
  // round-trip off the workflow.create hot path with negligible staleness
  // cost. The decorator invalidates per-key on save() to keep
  // publish/deprecate cycles correct.
  const templates = new CachedWorkflowTemplateRepository({
    delegate: templatesDelegate,
    ttlMs: 60_000,
    maxEntries: 100,
  });
  const idempotency = new InMemoryIdempotencyStore();
  const automatedRunner = new StubAutomatedStepRunner();
  const externalRunner = new StubExternalStepRunner();

  const authorisation = new IdentityAuthorisationAdapter(identityAuthorisationService);
  const uiGeneration = new UIGenerationAdapter(generateUIForStepCommand);

  const useCases = {
    publishTemplate: new PublishWorkflowTemplateUseCase({ templates, clock, authorisation }),
    deprecateTemplate: new DeprecateWorkflowTemplateUseCase({ templates, clock, authorisation }),
    createWorkflow: new CreateWorkflowUseCase({
      templates,
      workflows,
      clock,
      idGen,
      authorisation,
      idempotency,
    }),
    executeWorkflow: new ExecuteWorkflowUseCase({
      workflows,
      templates,
      clock,
      authorisation,
      idempotency,
      automatedRunner,
      externalRunner,
      uiGeneration,
    }),
    cancelWorkflow: new CancelWorkflowUseCase({ workflows, clock, authorisation }),
    advanceWorkflow: new AdvanceWorkflowUseCase({
      workflows,
      templates,
      clock,
      automatedRunner,
      externalRunner,
      uiGeneration,
    }),
    listTemplates: new ListWorkflowTemplatesQuery({ templates }),
    getTemplate: new GetWorkflowTemplateQuery({ templates }),
    getDetail: new GetWorkflowDetailQuery({ workflows }),
    listActive: new ListActiveWorkflowsQuery({ workflows }),
  };

  // Seed the three default templates when running with in-memory repos so
  // the dev server is immediately useful without any external setup.
  if (!pool) {
    await seedDefaultTemplates(templates, { mode: 'repository', clock });
  }

  const v1Router = createWorkflowRouter({
    publishTemplate: useCases.publishTemplate,
    deprecateTemplate: useCases.deprecateTemplate,
    createWorkflow: useCases.createWorkflow,
    executeWorkflow: useCases.executeWorkflow,
    cancelWorkflow: useCases.cancelWorkflow,
    listTemplates: useCases.listTemplates,
    getTemplate: useCases.getTemplate,
    getDetail: useCases.getDetail,
    listActive: useCases.listActive,
    idempotencyStore: idempotency,
  });
  const legacyRouter = createLegacyWorkflowRouter(v1Router);

  if (logger) {
    logger.info(
      `workflow-orchestration wired (${pool ? 'pg' : 'in-memory'} repos${
        pool ? '' : ', seeded default templates'
      })`,
    );
  }

  return {
    useCases,
    v1Router,
    legacyRouter,
    repositories: { workflows, templates },
    idempotency,
  };
}
