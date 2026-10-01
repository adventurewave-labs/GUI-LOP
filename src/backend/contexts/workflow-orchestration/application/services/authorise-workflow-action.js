// @ts-check
/**
 * Authorise an action on an existing workflow: role/grant permission first,
 * then the owner rule.
 *
 * Owner rule: the user who created a workflow may execute and cancel it.
 * Without it, an ordinary user (role `user`: read/create/respond) could
 * create a workflow but never start or stop it — the SPA offered both
 * buttons and every click was a 403. Everyone else still needs the explicit
 * `workflow:execute` / `workflow:cancel` permission, and a scoped API key
 * that withholds the action bounds the owner too.
 */
import { ForbiddenError } from '../../../../shared-kernel/domain/errors.js';

/**
 * @param {{
 *   authorisation: { authorise(a: any): Promise<{ allowed: boolean, reason?: string }> } | null | undefined,
 *   workflows: { findById(id: string): Promise<any> },
 *   actor: { id?: string, apiKeyPermissions?: string[] } | null | undefined,
 *   action: string,
 *   workflowId: string,
 * }} args
 */
export async function authoriseWorkflowAction({ authorisation, workflows, actor, action, workflowId }) {
  if (!authorisation) return;
  const decision = await authorisation.authorise({ actor, action, resource: { type: 'workflow', id: workflowId } });
  if (decision.allowed) return;

  const ceiling = actor?.apiKeyPermissions;
  const ceilingAllows = !Array.isArray(ceiling) || ceiling.length === 0 || ceiling.includes(action);
  if (actor?.id && ceilingAllows) {
    const wf = await workflows.findById(workflowId);
    if (wf?.createdBy != null && String(wf.createdBy) === String(actor.id)) return;
  }
  throw new ForbiddenError(decision.reason ?? 'forbidden');
}
