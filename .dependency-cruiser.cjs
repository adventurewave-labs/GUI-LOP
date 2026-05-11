/**
 * dependency-cruiser rules — enforces the four-layer hexagonal architecture
 * inside src/backend/ (ADR 0004, ADR 0018).
 *
 * Layers (inward import only):
 *   interfaces  -> application, domain, shared-kernel
 *   infrastructure -> application, domain, shared-kernel
 *   application -> domain, shared-kernel
 *   domain      -> shared-kernel
 *   bootstrap   -> anything (composition root)
 *
 * Strict mode (Phase 7): no legacy allowlist. The legacy
 * src/backend/{middleware,services,models,routes,utils,config,tests}/
 * trees + simple-server.js / database-server.js / enhanced-server.js
 * have been deleted. The "no-legacy-resurrection" rule below makes
 * any reintroduction fail CI.
 *
 * Run via: npm run lint:arch
 * (Requires: npm i -D dependency-cruiser)
 */
module.exports = {
  forbidden: [
    {
      name: 'domain-no-application',
      severity: 'error',
      comment:
        'domain/ must not import from application/, infrastructure/, or interfaces/',
      from: { path: '(^|/)src/backend/(shared-kernel|contexts/[^/]+)/domain/' },
      to: {
        path: '(^|/)src/backend/(shared-kernel|contexts/[^/]+)/(application|infrastructure|interfaces)/',
      },
    },
    {
      name: 'application-no-infrastructure',
      severity: 'error',
      comment:
        'application/ must not import from infrastructure/ or interfaces/',
      from: {
        path: '(^|/)src/backend/(shared-kernel|contexts/[^/]+)/application/',
      },
      to: {
        path: '(^|/)src/backend/(shared-kernel|contexts/[^/]+)/(infrastructure|interfaces)/',
      },
    },
    {
      name: 'infrastructure-no-interfaces',
      severity: 'error',
      comment: 'infrastructure/ must not import from interfaces/',
      from: {
        path: '(^|/)src/backend/(shared-kernel|contexts/[^/]+)/infrastructure/',
      },
      to: {
        path: '(^|/)src/backend/(shared-kernel|contexts/[^/]+)/interfaces/',
      },
    },
    {
      name: 'no-cross-context-imports',
      severity: 'error',
      comment:
        'One bounded context may not import directly from another. ' +
        'Cross-context coupling goes through ports declared in application/ ' +
        'and adapters wired at the composition root.',
      from: { path: '^src/backend/contexts/([^/]+)/' },
      to: {
        path: '^src/backend/contexts/([^/]+)/',
        pathNot: '^src/backend/contexts/$1/',
      },
    },
    {
      name: 'no-legacy-resurrection',
      severity: 'error',
      comment:
        'The legacy src/backend/{middleware,services,models,routes,utils,config,tests}/ ' +
        'trees were removed in Phase 7. Do not recreate them; add new code under ' +
        'src/backend/contexts/<context>/ or src/backend/shared-kernel/.',
      from: {},
      to: {
        path:
          '^src/backend/(middleware|services|models|routes|utils|config|tests|simple-server\\.js|database-server\\.js|enhanced-server\\.js|enhanced-auth-middleware\\.js)/?',
      },
    },
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular dependencies are forbidden',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      comment: 'Orphaned modules are usually a refactor leftover',
      from: {
        orphan: true,
        pathNot: [
          '(^|/)\\.[^/]+\\.(js|cjs|mjs|ts)$',
          '\\.d\\.ts$',
          '(^|/)tests?/',
          '(^|/)__tests__/',
          '(^|/)node_modules/',
        ],
      },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: {
      path: ['node_modules', '__tests__', '\\.test\\.js$', 'tests/'],
    },
    includeOnly: { path: '^src/backend/' },
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
