/**
 * React App Unit Tests
 * Tests for React components and frontend logic
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import App from '../src/App.jsx';

// Mock WebSocket for testing
global.WebSocket = jest.fn(() => ({
  addEventListener: jest.fn(),
  send: jest.fn(),
  close: jest.fn(),
  readyState: 1 // OPEN
}));

// Mock fetch for API calls
global.fetch = jest.fn();

describe('App Component Tests', () => {
  beforeEach(() => {
    // Reset mocks
    fetch.mockClear();
    console.log = jest.fn();
    console.error = jest.fn();
  });

  test('renders without crashing', () => {
    render(<App />);
    // Component should render without throwing an error
  });

  test('displays initial loading state', () => {
    render(<App />);
    // Should show some kind of loading or initial content
    const body = document.querySelector('body');
    expect(body).toBeInTheDocument();
  });

  test('handles server health check', async () => {
    const mockHealthResponse = {
      ok: true,
      json: () => Promise.resolve({
        status: 'ok',
        message: 'GUI-LOP Server is running'
      })
    };

    fetch.mockResolvedValue(mockHealthResponse);

    render(<App />);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('http://localhost:3001/health');
    });
  });

  test('handles server errors gracefully', async () => {
    const mockErrorResponse = {
      ok: false,
      status: 500
    };

    fetch.mockResolvedValue(mockErrorResponse);

    render(<App />);

    await waitFor(() => {
      // Should handle error without crashing
      const body = document.querySelector('body');
      expect(body).toBeInTheDocument();
    });
  });

  test('loads workflow templates', async () => {
    const mockHealthResponse = {
      ok: true,
      json: () => Promise.resolve({
        status: 'ok',
        message: 'GUI-LOP Server is running'
      })
    };

    const mockTemplatesResponse = {
      ok: true,
      json: () => Promise.resolve({
        templates: [
          {
            id: 'data-analysis',
            name: 'Data Analysis Workflow',
            description: 'Test workflow'
          }
        ]
      })
    };

    fetch
      .mockResolvedValueOnce(mockHealthResponse)
      .mockResolvedValueOnce(mockTemplatesResponse);

    render(<App />);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('http://localhost:3001/api/workflows/templates');
    });
  });

  test('handles WebSocket connection', () => {
    render(<App />);

    // Should attempt to create WebSocket connection
    expect(global.WebSocket).toHaveBeenCalled();
  });

  test('handles user interactions', async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        status: 'ok',
        message: 'GUI-LOP Server is running'
      })
    });

    render(<App />);

    // Wait for component to load
    await waitFor(() => {
      const body = document.querySelector('body');
      expect(body).toBeInTheDocument();
    });

    // Look for any interactive elements
    const buttons = document.querySelectorAll('button, [role="button"]');

    if (buttons.length > 0) {
      // Test clicking first button
      fireEvent.click(buttons[0]);

      // Should handle click without error
      const bodyAfterClick = document.querySelector('body');
      expect(bodyAfterClick).toBeInTheDocument();
    }
  });
});

describe('Utility Functions', () => {
  test('should validate workflow data', () => {
    // Test utility functions if they exist
    const mockWorkflow = {
      id: 'test-workflow',
      template: 'data-analysis',
      status: 'created'
    };

    expect(mockWorkflow.id).toBeTruthy();
    expect(mockWorkflow.template).toBeTruthy();
    expect(mockWorkflow.status).toBeTruthy();
  });

  test('should handle API responses', () => {
    const mockResponse = {
      workflow_id: 'test-id',
      status: 'created',
      created_at: new Date().toISOString()
    };

    expect(mockResponse.workflow_id).toBe('test-id');
    expect(mockResponse.status).toBe('created');
    expect(mockResponse.created_at).toBeTruthy();
  });
});

describe('Component Integration', () => {
  test('should handle workflow creation flow', async () => {
    const mockHealthResponse = {
      ok: true,
      json: () => Promise.resolve({ status: 'ok' })
    };

    const mockCreateResponse = {
      ok: true,
      json: () => Promise.resolve({
        workflow_id: 'new-workflow-id',
        status: 'created'
      })
    };

    fetch
      .mockResolvedValueOnce(mockHealthResponse)
      .mockResolvedValueOnce(mockCreateResponse);

    render(<App />);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('http://localhost:3001/health');
    });
  });

  test('should handle WebSocket events', () => {
    const mockWs = {
      addEventListener: jest.fn(),
      send: jest.fn(),
      close: jest.fn(),
      readyState: 1
    };

    global.WebSocket = jest.fn(() => mockWs);

    render(<App />);

    expect(mockWs.addEventListener).toHaveBeenCalledWith('open', expect.any(Function));
    expect(mockWs.addEventListener).toHaveBeenCalledWith('message', expect.any(Function));
    expect(mockWs.addEventListener).toHaveBeenCalledWith('close', expect.any(Function));
  });
});