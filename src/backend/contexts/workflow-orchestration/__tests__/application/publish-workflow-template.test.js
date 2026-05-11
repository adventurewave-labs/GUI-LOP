import { PublishWorkflowTemplateUseCase } from '../../application/commands/publish-workflow-template.js';
import { InMemoryWorkflowTemplateRepository } from '../../infrastructure/persistence/inmemory-workflow-template-repository.js';
import { AlwaysAllowAuthorisationService, AlwaysDenyAuthorisationService } from '../../application/ports/authorisation-service.js';
import { makeClock } from '../helpers/test-fixtures.js';

describe('PublishWorkflowTemplateUseCase', () => {
  it('creates and publishes a brand new template', async () => {
    const templates = new InMemoryWorkflowTemplateRepository();
    const uc = new PublishWorkflowTemplateUseCase({
      templates,
      clock: makeClock(),
      authorisation: new AlwaysAllowAuthorisationService(),
    });
    const out = await uc.execute({
      actor: { id: 'u1', role: 'admin' },
      key: 'k-one',
      name: 'K One',
      steps: [{ name: 'A', kind: 'automated' }],
    });
    expect(out.status).toBe('published');
    expect(out.version).toBe(1);
    const t = await templates.findCurrent('k-one');
    expect(t).not.toBeNull();
    expect(t.steps).toHaveLength(1);
  });

  it('auto-bumps the version when one already exists', async () => {
    const templates = new InMemoryWorkflowTemplateRepository();
    const uc = new PublishWorkflowTemplateUseCase({
      templates,
      clock: makeClock(),
      authorisation: new AlwaysAllowAuthorisationService(),
    });
    await uc.execute({
      actor: { id: 'u1' }, key: 'k-bump', name: 'k', steps: [{ name: 'A', kind: 'automated' }],
    });
    const out = await uc.execute({
      actor: { id: 'u1' }, key: 'k-bump', name: 'k v2', steps: [{ name: 'A', kind: 'automated' }],
    });
    expect(out.version).toBe(2);
  });

  it('forbids when authorisation denies', async () => {
    const templates = new InMemoryWorkflowTemplateRepository();
    const uc = new PublishWorkflowTemplateUseCase({
      templates,
      clock: makeClock(),
      authorisation: new AlwaysDenyAuthorisationService(),
    });
    await expect(uc.execute({
      actor: { id: 'u1' }, key: 'k-bump', name: 'k', steps: [{ name: 'A', kind: 'automated' }],
    })).rejects.toThrow(/forbidden|denied/i);
  });
});
