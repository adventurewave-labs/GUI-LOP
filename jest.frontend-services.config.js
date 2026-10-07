// Runs the framework-free frontend service tests (WebSocket + API clients)
// under the root Jest/Babel toolchain so CI covers them without installing
// the react-scripts tree. UI/component tests stay with `cd src/frontend && npm test`.
export default {
  rootDir: '.',
  testEnvironment: 'node',
  testMatch: [
    '<rootDir>/src/frontend/src/services/websocket/__tests__/*.test.js',
    // API client (refresh-on-401, idempotency, error mapping). Needs a DOM
    // for window.location; declared per-file via @jest-environment jsdom.
    '<rootDir>/src/frontend/src/services/api/__tests__/*.test.js',
  ],
  transform: { '^.+\\.jsx?$': 'babel-jest' },
  moduleNameMapper: { '^js-cookie$': '<rootDir>/tests/__stubs__/js-cookie.cjs' },
};
