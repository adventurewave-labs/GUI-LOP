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
