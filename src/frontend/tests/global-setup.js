/**
 * Playwright Global Setup
 * Runs before all tests
 */

async function globalSetup(config) {
  console.log('🚀 Starting Playwright global setup...');

  // Wait for servers to be ready
  const maxRetries = 30;
  let retries = 0;

  while (retries < maxRetries) {
    try {
      // Check backend server
      const backendResponse = await fetch('http://localhost:3001/health');
      if (backendResponse.ok) {
        console.log('✅ Backend server is ready');
        break;
      }
    } catch (error) {
      // Server not ready yet
    }

    try {
      // Check frontend server
      const frontendResponse = await fetch('http://localhost:3000');
      if (frontendResponse.ok) {
        console.log('✅ Frontend server is ready');
      }
    } catch (error) {
      // Frontend not ready yet
    }

    console.log(`⏳ Waiting for servers... (${retries + 1}/${maxRetries})`);
    await new Promise(resolve => setTimeout(resolve, 2000));
    retries++;
  }

  if (retries >= maxRetries) {
    throw new Error('❌ Servers failed to start within timeout period');
  }

  console.log('✅ Playwright global setup complete');
}

export default globalSetup;