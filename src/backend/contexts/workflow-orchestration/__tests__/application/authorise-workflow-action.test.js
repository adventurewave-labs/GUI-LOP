/**
 * Owner rule for execute/cancel (roadmap P4): creators can run and stop
 * their own workflows; others need the permission; scoped API keys bound
 * the owner too.
 */
import { authoriseWorkflowAction } from '../../application/services/authorise-workflow-action.js';

const OWNER = 'owner-1';
const wfRepo = (createdBy = OWNER) => ({ findById: jest.fn(async (id) => (id === 'wf-1' ? { id, createdBy } : null)) });
const deny = { authorise: jest.fn(async () => ({ allowed: false, reason: 'Permission denied: workflow:execute' })) };
const allow = { authorise: jest.fn(async () => ({ allowed: true })) };
const run = (over) => authoriseWorkflowAction({ authorisation: deny, workflows: wfRepo(), actor: { id: OWNER }, action: 'workflow:execute', workflowId: 'wf-1', ...over });

describe('authoriseWorkflowAction', () => {
  test('permission granted → allowed without loading the workflow', async () => {
    const workflows = wfRepo();
    await expect(run({ authorisation: allow, workflows })).resolves.toBeUndefined();
    expect(workflows.findById).not.toHaveBeenCalled();
  });

  test('no permission but creator → allowed', async () => {
    await expect(run()).resolves.toBeUndefined();
    await expect(run({ action: 'workflow:cancel' })).resolves.toBeUndefined();
  });

  test('no permission and not the creator → 403 with the original reason', async () => {
    await expect(run({ actor: { id: 'someone-else' } })).rejects.toMatchObject({ name: 'ForbiddenError', message: 'Permission denied: workflow:execute' });
    await expect(run({ workflows: wfRepo(null) })).rejects.toMatchObject({ name: 'ForbiddenError' });
    await expect(run({ workflowId: 'missing' })).rejects.toMatchObject({ name: 'ForbiddenError' });
    await expect(run({ actor: null })).rejects.toMatchObject({ name: 'ForbiddenError' });
  });

  test('a scoped API key that withholds the action bounds the owner; one that includes it does not', async () => {
    await expect(run({ actor: { id: OWNER, apiKeyPermissions: ['workflow:read'] } })).rejects.toMatchObject({ name: 'ForbiddenError' });
    await expect(run({ actor: { id: OWNER, apiKeyPermissions: ['workflow:execute'] } })).resolves.toBeUndefined();
    await expect(run({ actor: { id: OWNER, apiKeyPermissions: [] } })).resolves.toBeUndefined();
  });

  test('no authorisation port configured → allowed (dev wiring unchanged)', async () => {
    await expect(run({ authorisation: null })).resolves.toBeUndefined();
  });
});
