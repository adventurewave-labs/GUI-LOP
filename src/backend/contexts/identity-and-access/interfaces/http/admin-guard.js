/**
 * Express middleware: ensure the authenticated principal has the
 * `admin` role. Must run AFTER `makeAuthMiddleware` populates
 * `req.principal`.
 *
 * Returns 401 (no principal) or 403 (principal but not admin) with the
 * canonical envelope shape used elsewhere in this context.
 */
export function adminGuard(req, res, next) {
  const principal = req?.principal;
  if (!principal || typeof principal !== 'object') {
    res.status(401).json({
      success: false,
      code: 'unauthorised',
      message: 'authentication required',
    });
    return;
  }
  if (principal.role !== 'admin') {
    res.status(403).json({
      success: false,
      code: 'forbidden',
      message: 'admin only',
    });
    return;
  }
  next();
}
