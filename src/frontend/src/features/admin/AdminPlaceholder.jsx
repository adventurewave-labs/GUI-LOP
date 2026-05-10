import React from 'react';

/**
 * Admin features (template publishing, deprecation, dead-letter retry,
 * subscription management) live behind admin-only backend routes. The
 * UI for these is intentionally a stub for the cutover; the API client
 * already exposes the calls (see `templatesApi.publish`, `templatesApi.deprecate`).
 */
export default function AdminPlaceholder() {
  return (
    <div data-testid="admin-placeholder">
      <h2>Admin</h2>
      <p>Admin tooling is stubbed for now. See ADRs 0007/0017 for the route map.</p>
    </div>
  );
}
