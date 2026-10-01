// @ts-check
/**
 * wire-human-interaction.js — composition for the Human Interaction context.
 */
import { InMemoryHumanResponseRepository } from '../contexts/human-interaction/infrastructure/persistence/inmemory-human-response-repository.js';
import { InMemoryPendingStepRepository } from '../contexts/human-interaction/infrastructure/persistence/inmemory-pending-step-repository.js';
import { PgHumanResponseRepository } from '../contexts/human-interaction/infrastructure/persistence/pg-human-response-repository.js';
import { PgPendingStepRepository } from '../contexts/human-interaction/infrastructure/persistence/pg-pending-step-repository.js';
import { InMemoryEventPublisher } from '../contexts/human-interaction/application/ports/event-publisher.js';
import { UnitOfWorkFactory } from '../contexts/human-interaction/application/ports/unit-of-work.js';

import { RecordHumanResponse } from '../contexts/human-interaction/application/commands/record-human-response.js';
import { CloseAbandonedStep } from '../contexts/human-interaction/application/commands/close-abandoned-step.js';
import { EscalateOverdueStep } from '../contexts/human-interaction/application/commands/escalate-overdue-step.js';
import { GetPendingStep } from '../contexts/human-interaction/application/queries/get-pending-step.js';
import { ListPendingStepsForUser } from '../contexts/human-interaction/application/queries/list-pending-steps-for-user.js';
import { OnWorkflowHumanInputRequired } from '../contexts/human-interaction/application/event-handlers/on-workflow-human-input-required.js';
import { OnWorkflowCancelled } from '../contexts/human-interaction/application/event-handlers/on-workflow-cancelled.js';
import { start as startDeadlineWatcher } from '../contexts/human-interaction/application/services/deadline-watcher.js';

import { createHumanInteractionRouter } from '../contexts/human-interaction/interfaces/http/human-interaction-router.js';

/**
 * Adapter that fulfils Human Interaction's `WorkflowAdvancer` port by
 * calling Workflow Orchestration's `AdvanceWorkflow` use case in process.
 */
class InProcessWorkflowAdvancer {
  constructor(advanceWorkflowUseCase) {
    this._advance = advanceWorkflowUseCase;
  }
  async advance({ workflowId, stepId, response }) {
    if (!this._advance) return;
    try {
      await this._advance.execute({
        workflowId,
        stepId,
        response,
        actor: { id: response?.responder ?? 'system', type: 'user' },
      });
    } catch (_err) {
      // The deadline watcher and follow-up calls will retry; never let
      // advancement failures kill the synchronous response submission.
    }
  }
}

/**
 * Tiny user/role directory backed by the Identity user repository so the
 * eligibility service has the data it needs even in dev mode.
 */
export class IdentityBackedUserDirectory {
  /**
   * @param {{ userRepository?: any, roleRepository?: any, grantsRepository?: any }} deps
   */
  constructor({ userRepository, roleRepository, grantsRepository } = {}) {
    this._users = userRepository;
    this._roles = roleRepository;
    this._grants = grantsRepository;
  }

  /**
   * Eligibility view of a user: role-derived permissions plus direct grants,
   * composed exactly like identity's AuthorisationService. (This used to
   * return `permissions: []` unconditionally, so a human step with
   * `requiredPermissions` could never be answered by anyone.) Scoped grants
   * keep their `resource:action@scope` form and contribute their scope to
   * `scopes`, so an unscoped requirement is never satisfied by a scoped grant.
   * @param {string} id
   * @returns {Promise<{ id: string, role: string, isActive: boolean, permissions: string[], scopes: string[] } | null>}
   */
  async getUser(id) {
    if (!this._users) return null;
    const u = await this._users.findById(id);
    if (!u) return null;
    const roleName = u.role?.value ?? 'user';
    const [role, grants] = await Promise.all([
      this._roles?.findByName?.(roleName) ?? null,
      this._grants?.list?.(String(u.id?.value ?? u.id)) ?? [],
    ]);
    const all = [...(role?.permissions ?? []), ...(grants ?? [])];
    const permissions = [...new Set(all.map((p) => String(p?.value ?? p)))];
    const scopes = [...new Set(all.map((p) => p?.scope).filter((sc) => typeof sc === 'string' && sc))];
    return {
      id: u.id?.value ?? u.id,
      role: roleName,
      isActive: u.isActive ?? true,
      permissions,
      scopes,
    };
  }
}

/**
 * Read-side workflow lookup adapter. Dev mode falls back to a stub that
 * returns a minimal summary so HumanInteraction can still validate steps.
 */
class WorkflowReaderAdapter {
  constructor(getDetailQuery) {
    this._get = getDetailQuery;
  }
  async getSummary(workflowId) {
    if (!this._get) return null;
    try {
      return await this._get.execute({ workflowId });
    } catch (_err) {
      return null;
    }
  }
  async getStep(workflowId, stepId) {
    const wf = await this.getSummary(workflowId);
    if (!wf || !Array.isArray(wf.steps)) return null;
    return wf.steps.find((s) => s.id === stepId) ?? null;
  }
}

export function wireHumanInteraction({
  pool,
  clock,
  idGen,
  identityUserRepository,
  identityRoleRepository,
  identityGrantsRepository,
  identityAuthorisationService,
  workflowAdvanceUseCase,
  workflowGetDetailQuery,
  logger,
}) {
  const responseRepository = pool
    ? new PgHumanResponseRepository(pool)
    : new InMemoryHumanResponseRepository();
  const pendingStepRepository = pool
    ? new PgPendingStepRepository(pool)
    : new InMemoryPendingStepRepository();
  const eventPublisher = new InMemoryEventPublisher();
  const unitOfWork = new UnitOfWorkFactory();

  const userDirectory = new IdentityBackedUserDirectory({
    userRepository: identityUserRepository,
    roleRepository: identityRoleRepository,
    grantsRepository: identityGrantsRepository,
  });
  const workflowReader = new WorkflowReaderAdapter(workflowGetDetailQuery);
  const workflowAdvancer = new InProcessWorkflowAdvancer(workflowAdvanceUseCase);

  // Identity AuthorisationService.ensure throws on deny; the human-interaction
  // port expects a non-throwing `authorise()` returning `{ authorised, ... }`.
  const authorisation = {
    async authorise({ actor, permission, scope }) {
      if (!actor || !actor.userId) return { authorised: false, reason: 'no_actor' };
      if (!identityAuthorisationService) return { authorised: true };
      try {
        await identityAuthorisationService.ensure({
          userId: actor.userId,
          permission,
          scope,
          ceiling: actor.apiKeyPermissions ?? null,
        });
        return { authorised: true };
      } catch (err) {
        return { authorised: false, reason: err?.message ?? 'forbidden' };
      }
    },
  };

  const ids = {
    next: () => idGen.newId(),
  };

  const useCases = {
    recordHumanResponse: new RecordHumanResponse({
      responseRepository,
      pendingStepRepository,
      workflowReader,
      userDirectory,
      authorisation,
      workflowAdvancer,
      eventPublisher,
      unitOfWork,
      clock,
      ids,
    }),
    closeAbandonedStep: new CloseAbandonedStep({
      pendingStepRepository,
      eventPublisher,
      unitOfWork,
      clock,
    }),
    escalateOverdueStep: new EscalateOverdueStep({
      pendingStepRepository,
      eventPublisher,
      unitOfWork,
      clock,
    }),
    getPendingStep: new GetPendingStep({ pendingStepRepository }),
    listPendingStepsForUser: new ListPendingStepsForUser({
      pendingStepRepository,
      userDirectory,
      workflowReader,
    }),
  };

  const eventHandlers = {
    onWorkflowHumanInputRequired: new OnWorkflowHumanInputRequired({
      pendingStepRepository,
      unitOfWork,
      clock,
    }),
    onWorkflowCancelled: new OnWorkflowCancelled({
      pendingStepRepository,
      closeAbandonedStep: useCases.closeAbandonedStep,
    }),
  };

  const router = createHumanInteractionRouter({
    recordHumanResponse: useCases.recordHumanResponse,
    listPendingStepsForUser: useCases.listPendingStepsForUser,
    getPendingStep: useCases.getPendingStep,
  });

  function startWatcher({ intervalMs = 30_000 } = {}) {
    return startDeadlineWatcher({
      intervalMs,
      escalateUseCase: useCases.escalateOverdueStep,
      pendingStepRepository,
      clock,
    });
  }

  if (logger) {
    logger.info(
      `human-interaction wired (${pool ? 'pg' : 'in-memory'} repos)`,
    );
  }

  return {
    useCases,
    eventHandlers,
    router,
    repositories: { responseRepository, pendingStepRepository },
    eventPublisher,
    startWatcher,
  };
}
