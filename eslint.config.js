// ESLint 9 flat config — backend (Node ESM) + backend tests.
// The React SPA under src/frontend has its own toolchain and is out of scope.
import js from '@eslint/js';
import globals from 'globals';
import n from 'eslint-plugin-n';
import security from 'eslint-plugin-security';

export default [
  {
    ignores: [
      'node_modules/**',
      'coverage/**',
      'src/frontend/**',
      'public/**',
      'infrastructure/**',
      'docker/**',
      // Legacy load/perf harnesses — not part of the backend gate yet.
      'tests/load/**',
      'tests/api/**',
      'tests/security/**',
    ],
  },

  js.configs.recommended,
  n.configs['flat/recommended-module'],
  security.configs.recommended,

  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    settings: { node: { version: '>=22.12.0' } },
    rules: {
      // --- correctness ---
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-console': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-return-await': 'off',
      'no-promise-executor-return': 'error',
      'no-unsafe-optional-chaining': 'error',
      'require-atomic-updates': 'off', // noisy false positives with Express req mutation
      'no-empty': ['error', { allowEmptyCatch: true }],

      // --- node ---
      'n/no-process-exit': 'off', // only the entry point exits; enforced via no-console scope
      'n/no-unpublished-import': 'off', // devDeps legitimately imported by tests
      'n/no-missing-import': 'off', // resolver can't follow package "exports" in all deps
      'n/no-unsupported-features/node-builtins': 'error',

      // --- security ---
      // Object-injection fires on every computed property access; too noisy
      // to be a gate. Keep the rest (child_process, eval, regex DoS, …).
      'security/detect-object-injection': 'off',
      'security/detect-non-literal-fs-filename': 'warn',
    },
  },

  // The entry point and CLI scripts are the only places allowed to print.
  {
    files: [
      'src/backend/bootstrap/index.js',
      'database/**/*.js',
      'scripts/**/*.js',
    ],
    rules: { 'no-console': 'off' },
  },

  // CommonJS configs.
  {
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
  },

  // Tests.
  {
    files: ['**/__tests__/**/*.js', '**/*.test.js', 'tests/**/*.js'],
    languageOptions: { globals: { ...globals.node, ...globals.jest } },
    rules: {
      'no-console': 'off',
      'security/detect-non-literal-regexp': 'off',
      'security/detect-non-literal-fs-filename': 'off',
      'no-promise-executor-return': 'off',
    },
  },
];
