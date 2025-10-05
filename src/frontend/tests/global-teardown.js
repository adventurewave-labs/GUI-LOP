/**
 * Playwright Global Teardown
 * Runs after all tests
 */

async function globalTeardown(config) {
  console.log('🧹 Starting Playwright global teardown...');

  // Clean up any test data if needed
  // This is where you could clean up test workflows, databases, etc.

  console.log('✅ Playwright global teardown complete');
}

export default globalTeardown;