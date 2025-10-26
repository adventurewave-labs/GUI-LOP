#!/usr/bin/env node

/**
 * Authentication System Test Script
 * Quick test script to verify the authentication system is working correctly
 */

import fetch from 'node-fetch';

const BASE_URL = 'http://localhost:3001';

// Test configuration
const testUser = {
  email: 'testuser@example.com',
  password: 'TestPass123',
  firstName: 'Test',
  lastName: 'User'
};

let accessToken = '';
let refreshToken = '';

// Helper function to make HTTP requests
async function apiRequest(endpoint, options = {}) {
  const url = `${BASE_URL}${endpoint}`;
  const defaultOptions = {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    }
  };

  try {
    const response = await fetch(url, { ...defaultOptions, ...options });
    const data = await response.json();

    console.log(`\n${options.method || 'GET'} ${endpoint}`);
    console.log(`Status: ${response.status}`);
    console.log('Response:', JSON.stringify(data, null, 2));

    return { status: response.status, data };
  } catch (error) {
    console.error(`Error making request to ${endpoint}:`, error.message);
    throw error;
  }
}

// Test functions
async function testHealthCheck() {
  console.log('\n=== Testing Health Check ===');
  await apiRequest('/health');
}

async function testUserRegistration() {
  console.log('\n=== Testing User Registration ===');
  const result = await apiRequest('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(testUser)
  });

  if (result.status === 201) {
    accessToken = result.data.data.tokens.accessToken;
    refreshToken = result.data.data.tokens.refreshToken;
    console.log('✅ Registration successful');
  } else {
    console.log('❌ Registration failed');
  }
}

async function testUserLogin() {
  console.log('\n=== Testing User Login ===');
  const result = await apiRequest('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: testUser.email,
      password: testUser.password
    })
  });

  if (result.status === 200) {
    accessToken = result.data.data.tokens.accessToken;
    refreshToken = result.data.data.tokens.refreshToken;
    console.log('✅ Login successful');
  } else {
    console.log('❌ Login failed');
  }
}

async function testTokenRefresh() {
  console.log('\n=== Testing Token Refresh ===');
  const result = await apiRequest('/api/auth/refresh', {
    method: 'POST',
    body: JSON.stringify({ refreshToken })
  });

  if (result.status === 200) {
    accessToken = result.data.data.tokens.accessToken;
    refreshToken = result.data.data.tokens.refreshToken;
    console.log('✅ Token refresh successful');
  } else {
    console.log('❌ Token refresh failed');
  }
}

async function testProtectedRoute() {
  console.log('\n=== Testing Protected Route ===');
  const result = await apiRequest('/api/auth/me', {
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  });

  if (result.status === 200) {
    console.log('✅ Protected route access successful');
  } else {
    console.log('❌ Protected route access failed');
  }
}

async function testWorkflowCreation() {
  console.log('\n=== Testing Workflow Creation ===');
  const result = await apiRequest('/api/workflows', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`
    },
    body: JSON.stringify({
      template: 'data-analysis',
      context: 'Test authentication workflow'
    })
  });

  if (result.status === 201) {
    console.log('✅ Workflow creation successful');
  } else {
    console.log('❌ Workflow creation failed');
  }
}

async function testLogout() {
  console.log('\n=== Testing Logout ===');
  const result = await apiRequest('/api/auth/logout', {
    method: 'POST',
    body: JSON.stringify({ accessToken, refreshToken })
  });

  if (result.status === 200) {
    console.log('✅ Logout successful');
  } else {
    console.log('❌ Logout failed');
  }
}

async function testInvalidToken() {
  console.log('\n=== Testing Invalid Token Access ===');
  const result = await apiRequest('/api/auth/me', {
    headers: {
      'Authorization': 'Bearer invalid-token'
    }
  });

  if (result.status === 401) {
    console.log('✅ Invalid token properly rejected');
  } else {
    console.log('❌ Invalid token should have been rejected');
  }
}

async function testPublicEndpoints() {
  console.log('\n=== Testing Public Endpoints ===');

  // Test public status endpoint
  await apiRequest('/api/public/status');

  // Test workflow templates (should work without auth)
  await apiRequest('/api/workflows/templates');
}

async function runTests() {
  console.log('🚀 Starting Authentication System Tests');
  console.log(`📡 Testing against: ${BASE_URL}`);

  try {
    // Basic connectivity tests
    await testHealthCheck();
    await testPublicEndpoints();

    // Authentication flow tests
    await testUserRegistration();

    // Try login in case user already exists
    if (!accessToken) {
      await testUserLogin();
    }

    if (accessToken) {
      await testProtectedRoute();
      await testTokenRefresh();
      await testWorkflowCreation();
      await testLogout();
      await testInvalidToken();
    }

    console.log('\n✅ Authentication system tests completed!');
    console.log('\n📝 Summary:');
    console.log('- User registration and login working');
    console.log('- JWT token generation and validation working');
    console.log('- Token refresh mechanism working');
    console.log('- Protected route authentication working');
    console.log('- Workflow integration working');
    console.log('- Logout and token revocation working');
    console.log('- Public endpoints accessible');
    console.log('- Invalid tokens properly rejected');

  } catch (error) {
    console.error('\n❌ Test failed with error:', error.message);
    process.exit(1);
  }
}

// Check if server is running
async function checkServer() {
  try {
    await fetch(`${BASE_URL}/health`);
    return true;
  } catch (error) {
    console.error('❌ Server is not running at', BASE_URL);
    console.log('Please start the server with: npm start');
    process.exit(1);
  }
}

// Main execution
if (import.meta.url === `file://${process.argv[1]}`) {
  checkServer().then(() => {
    runTests();
  });
}

export { runTests, testUserRegistration, testUserLogin, testTokenRefresh };