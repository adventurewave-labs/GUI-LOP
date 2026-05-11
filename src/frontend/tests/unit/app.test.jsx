/**
 * Smoke tests for the v1 App shell.
 *
 * The previous tests were pinned to the legacy `simple-server` integration
 * (the old App auto-fetched `/api/workflows/templates` and opened a
 * WebSocket on mount). The new App is route-driven: it only fetches data
 * once a route is mounted, so these tests simply verify the shell renders
 * and the unauthenticated user lands on `/login`.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

// Mock the WebSocket so the v1 client (lazily created via the workflow events
// hook) doesn't try to open a real socket if a feature route mounts.
global.WebSocket = jest.fn(function FakeWS() {
  this.send = jest.fn();
  this.close = jest.fn();
  this.readyState = 0;
});

// Mock fetch (App's HealthBadge calls /health on mount).
global.fetch = jest.fn(() =>
  Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ status: 'ok' }),
    text: () => Promise.resolve(JSON.stringify({ status: 'ok' })),
  }),
);

import App from '../../src/App.jsx';

describe('App shell (v1)', () => {
  beforeEach(() => {
    fetch.mockClear();
    localStorage.clear();
  });

  test('renders without crashing', () => {
    render(<App />);
    // Brand title rendered by the header
    expect(screen.getByText('GUI-LOP')).toBeInTheDocument();
  });

  test('polls /health on the v1 base URL', async () => {
    render(<App />);
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(expect.stringMatching(/\/health$/));
    });
  });

  test('unauthenticated visit lands on /login', async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId('login-page')).toBeInTheDocument();
    });
  });
});
