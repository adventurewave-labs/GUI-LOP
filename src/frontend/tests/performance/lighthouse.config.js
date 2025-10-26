/**
 * Lighthouse CI configuration for automated performance testing
 */

module.exports = {
  ci: {
    collect: {
      url: ['http://localhost:3001'],
      startServerCommand: 'npm run serve',
      startServerReadyPattern: 'Accepting connections',
      startServerReadyTimeout: 30000,
      numberOfRuns: 3
    },
    assert: {
      assertions: {
        'categories:performance': ['warn', { minScore: 0.9 }],
        'categories:accessibility': ['error', { minScore: 0.9 }],
        'categories:best-practices': ['warn', { minScore: 0.9 }],
        'categories:seo': ['off', { minScore: 0.8 }],
        'categories:pwa': 'off'
      }
    },
    upload: {
      target: 'temporary-public-storage'
    }
  }
};