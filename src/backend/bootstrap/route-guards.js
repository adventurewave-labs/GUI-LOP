// @ts-check
/**
 * Route guards for contexts whose routers carry no authorisation of their
 * own (audit-and-analytics, notification). They were mounted behind
 * authentication only, so ANY signed-in user — a `viewer`, or an API key
 * scoped to one permission — could read the complete audit trail, export
 * compliance data, read and replay dead letters, and manage other users'
 * subscriptions. Decisions go through identity's AuthorisationService, so
 * admins pass implicitly and API-key ceilings are honoured.
 */

const deny = (res, detail) => res.status(403).json({ error: 'forbidden', code: 'FORBIDDEN', message: detail });

/**
 * @param {{ evaluate(q: { userId: string, permission: string, scope?: string|null, ceiling?: string[]|null }): Promise<{ isFail(): boolean }> }} authorisation
 * @param {string} permission  `resource:action`
 */
export function requirePermission(authorisation, permission) {
  return async function requirePermissionMiddleware(req, res, next) {
    try {
      const userId = req.user?.id;
      if (!userId) return deny(res, 'Authentication required');
      const result = await authorisation.evaluate({ userId, permission, ceiling: req.user.apiKeyPermissions ?? null });
      const allowed = Boolean(result) && typeof result.isFail === 'function' && !result.isFail();
      if (!allowed) return deny(res, `Permission denied: ${permission}`);
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

/**
 * Allow when the path parameter names the caller, otherwise require a permission.
 * @param {Parameters<typeof requirePermission>[0]} authorisation
 * @param {string} permission
 * @param {(req: any) => string|undefined} subjectOf
 */
export function selfOrPermission(authorisation, permission, subjectOf) {
  const fallback = requirePermission(authorisation, permission);
  return function selfOrPermissionMiddleware(req, res, next) {
    const subject = subjectOf(req);
    if (subject && req.user?.id && String(subject) === String(req.user.id)) return next();
    return fallback(req, res, next);
  };
}

const MAX_WEBHOOK_WORKFLOWS = 50;

/**
 * Webhook registration scope.
 *
 * A webhook with an empty filter receives EVERY event the platform emits —
 * every user's workflows, responses and identity events — and any signed-in
 * user could register one. A subscription is a standing export to a third
 * party, so it is held to a stricter rule than a one-off read:
 *
 *   - `notification:admin` (admins implicitly): any filter, including none;
 *   - everyone else: `filter.workflowIds` must name 1..50 workflows the
 *     caller created, and the caller needs `workflow:read` (so a key scoped
 *     to something else cannot set up an export).
 *
 * @param {Parameters<typeof requirePermission>[0]} authorisation
 * @param {(workflowId: string) => Promise<string|null>} ownerOf  creator of a workflow, or null when unknown
 */
export function webhookScopeGuard(authorisation, ownerOf) {
  const allowed = async (req, permission) => {
    const result = await authorisation.evaluate({ userId: req.user.id, permission, ceiling: req.user.apiKeyPermissions ?? null });
    return Boolean(result) && typeof result.isFail === 'function' && !result.isFail();
  };
  return async function webhookScopeMiddleware(req, res, next) {
    try {
      if (!req.user?.id) return deny(res, 'Authentication required');
      if (await allowed(req, 'notification:admin')) return next();
      if (!(await allowed(req, 'workflow:read'))) return deny(res, 'Permission denied: workflow:read');
      const ids = req.body?.filter?.workflowIds;
      const scoped = Array.isArray(ids) && ids.length > 0 && ids.length <= MAX_WEBHOOK_WORKFLOWS && ids.every((id) => typeof id === 'string' && id.length > 0);
      if (!scoped) {
        return res.status(403).json({
          error: 'forbidden',
          code: 'WEBHOOK_SCOPE_REQUIRED',
          message: `filter.workflowIds must list 1 to ${MAX_WEBHOOK_WORKFLOWS} workflows you created; an unfiltered webhook needs notification:admin`,
        });
      }
      for (const id of new Set(ids)) {
        const owner = await ownerOf(id);
        // Same answer for "not yours" and "does not exist".
        if (owner == null || String(owner) !== String(req.user.id)) {
          return res.status(403).json({ error: 'forbidden', code: 'WEBHOOK_SCOPE_REQUIRED', message: 'filter.workflowIds may only name workflows you created' });
        }
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}
