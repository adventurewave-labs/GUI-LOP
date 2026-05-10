/**
 * Test helpers — fakes/stubs for the application-layer tests.
 */
import { InMemoryHumanResponseRepository } from '../../infrastructure/persistence/inmemory-human-response-repository.js';
import { InMemoryPendingStepRepository } from '../../infrastructure/persistence/inmemory-pending-step-repository.js';
import { InMemoryEventPublisher } from '../../application/ports/event-publisher.js';
import { UnitOfWorkFactory } from '../../application/ports/unit-of-work.js';
import { FixedClock } from '../../application/ports/clock.js';
import { SequenceIdGenerator } from '../../application/ports/id-generator.js';
import { PendingStep } from '../../domain/pending-step/pending-step.js';

export class StubAuthorisationService {
  constructor({ authorised = true, reason, user } = {}) {
    this._authorised = authorised;
    this._reason = reason;
    this._user = user;
    this.calls = [];
  }
  async authorise(args) {
    this.calls.push(args);
    return { authorised: this._authorised, reason: this._reason, user: this._user };
  }
}

export class StubUserDirectory {
  constructor(users = {}) {
    this._users = users;
  }
  async getUser(id) { return this._users[id] ?? null; }
  set(user) { this._users[user.id] = user; }
}

export class StubWorkflowReader {
  constructor(workflows = {}) {
    this._workflows = workflows;
  }
  async getSummary(id) { return this._workflows[id] ?? null; }
  async getStep(workflowId, stepId) {
    const wf = this._workflows[workflowId];
    if (!wf || !Array.isArray(wf.steps)) return null;
    return wf.steps.find((s) => s.id === stepId) ?? null;
  }
}

export class StubWorkflowAdvancer {
  constructor() { this.calls = []; }
  async advance(args) { this.calls.push(args); }
}

export function buildContext({ now = new Date('2026-05-10T10:00:00Z'), users = {}, workflows = {}, authorised = true, reason } = {}) {
  const responseRepository = new InMemoryHumanResponseRepository();
  const pendingStepRepository = new InMemoryPendingStepRepository();
  const eventPublisher = new InMemoryEventPublisher();
  const unitOfWork = new UnitOfWorkFactory();
  const clock = new FixedClock(now);
  const ids = new SequenceIdGenerator('resp-');
  const userDirectory = new StubUserDirectory(users);
  const workflowReader = new StubWorkflowReader(workflows);
  const authorisation = new StubAuthorisationService({ authorised, reason, user: users[Object.keys(users)[0]] });
  const workflowAdvancer = new StubWorkflowAdvancer();
  return {
    responseRepository,
    pendingStepRepository,
    eventPublisher,
    unitOfWork,
    clock,
    ids,
    userDirectory,
    workflowReader,
    authorisation,
    workflowAdvancer,
  };
}

export async function seedPendingStep(repo, overrides = {}) {
  const step = PendingStep.open({
    workflowId: overrides.workflowId ?? 'wf-1',
    stepId: overrides.stepId ?? 'step-1',
    eligibility: overrides.eligibility ?? {
      requiredRole: 'reviewer',
      requiredPermissions: ['workflow:respond'],
      scope: 'wf-1',
    },
    deadline: overrides.deadline,
    onTimeout: overrides.onTimeout ?? 'escalate',
    now: overrides.now ?? new Date('2026-05-10T10:00:00Z'),
  });
  await repo.upsert(step);
  return step;
}
