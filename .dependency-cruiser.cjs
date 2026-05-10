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
