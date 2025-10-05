import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { UIContainer } from '../../../src/frontend/components/UIContainer.jsx';
import { EventHandlers } from '../../../src/frontend/components/EventHandlers.jsx';
import { WorkflowManager } from '../../../src/frontend/components/WorkflowManager.jsx';

// Mock WebSocket
class MockWebSocket {
  static instances = [];
  constructor(url) {
    MockWebSocket.instances.push(this);
    this.url = url;
    this.readyState = 1;
    this.send = jest.fn();
    this.close = jest.fn();
    this.addEventListener = jest.fn();
    this.removeEventListener = jest.fn();
  }
}

global.WebSocket = MockWebSocket;

describe('UIContainer Component', () => {
  const mockProps = {
    sessionId: 'session-123',
    workflowId: 'workflow-456',
    uiUrl: 'http://localhost:8501',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should render UI container with iframe', () => {
    render(<UIContainer {...mockProps} />);

    const iframe = screen.getByTitle('Generated UI');
    expect(iframe).toBeInTheDocument();
    expect(iframe.src).toBe(mockProps.uiUrl);
  });

  it('should handle UI load events', async () => {
    const onLoad = jest.fn();
    render(<UIContainer {...mockProps} onLoad={onLoad} />);

    const iframe = screen.getByTitle('Generated UI');
    fireEvent.load(iframe);

    await waitFor(() => {
      expect(onLoad).toHaveBeenCalled();
    });
  });

  it('should handle UI error events', async () => {
    const onError = jest.fn();
    render(<UIContainer {...mockProps} onError={onError} />);

    const iframe = screen.getByTitle('Generated UI');
    fireEvent.error(iframe);

    await waitFor(() => {
      expect(onError).toHaveBeenCalled();
    });
  });

  it('should resize iframe based on content', async () => {
    render(<UIContainer {...mockProps} autoResize={true} />);

    const iframe = screen.getByTitle('Generated UI');

    // Simulate content resize message
    const resizeMessage = {
      type: 'resize',
      data: { height: 800, width: 1200 },
    };

    window.postMessage(resizeMessage, '*');

    await waitFor(() => {
      expect(iframe.style.height).toBe('800px');
      expect(iframe.style.width).toBe('1200px');
    });
  });

  it('should handle secure communication with generated UI', async () => {
    render(<UIContainer {...mockProps} secureMode={true} />);

    const iframe = screen.getByTitle('Generated UI');

    // Verify secure attributes
    expect(iframe).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms');
    expect(iframe).toHaveAttribute('allow', 'accelerometer; camera; gyroscope');
  });

  it('should handle UI loading timeout', async () => {
    jest.useFakeTimers();
    const onTimeout = jest.fn();

    render(<UIContainer {...mockProps} timeout={5000} onTimeout={onTimeout} />);

    jest.advanceTimersByTime(5000);

    await waitFor(() => {
      expect(onTimeout).toHaveBeenCalled();
    });

    jest.useRealTimers();
  });
});

describe('EventHandlers Component', () => {
  const mockHandlers = {
    onUIUpdate: jest.fn(),
    onToolInputRequest: jest.fn(),
    onApprovalRequest: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should initialize WebSocket connection', () => {
    render(<EventHandlers sessionId="session-123" handlers={mockHandlers} />);

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0].url).toContain('session-123');
  });

  it('should handle incoming AG-UI events', async () => {
    render(<EventHandlers sessionId="session-123" handlers={mockHandlers} />);

    const ws = MockWebSocket.instances[0];

    // Simulate incoming message
    const message = {
      type: 'ui_update',
      payload: {
        componentId: 'dashboard-456',
        data: { metrics: { revenue: 10000 } },
      },
    };

    ws.onmessage({ data: JSON.stringify(message) });

    await waitFor(() => {
      expect(mockHandlers.onUIUpdate).toHaveBeenCalledWith(message.payload);
    });
  });

  it('should handle tool input requests', async () => {
    render(<EventHandlers sessionId="session-123" handlers={mockHandlers} />);

    const ws = MockWebSocket.instances[0];

    const message = {
      type: 'tool_input_request',
      payload: {
        requestId: 'req-123',
        toolName: 'data_visualizer',
        parameters: { dataType: 'sales' },
      },
    };

    ws.onmessage({ data: JSON.stringify(message) });

    await waitFor(() => {
      expect(mockHandlers.onToolInputRequest).toHaveBeenCalledWith(message.payload);
    });
  });

  it('should handle approval requests', async () => {
    render(<EventHandlers sessionId="session-123" handlers={mockHandlers} />);

    const ws = MockWebSocket.instances[0];

    const message = {
      type: 'approval_request',
      payload: {
        workflowId: 'workflow-456',
        stepId: 'step-2',
        message: 'Please approve the configuration',
        options: ['approve', 'reject'],
      },
    };

    ws.onmessage({ data: JSON.stringify(message) });

    await waitFor(() => {
      expect(mockHandlers.onApprovalRequest).toHaveBeenCalledWith(message.payload);
    });
  });

  it('should send responses back to backend', async () => {
    const sendResponse = jest.fn();
    render(<EventHandlers sessionId="session-123" handlers={mockHandlers} sendResponse={sendResponse} />);

    const ws = MockWebSocket.instances[0];

    // Simulate response to approval request
    const response = {
      type: 'approval_response',
      payload: {
        requestId: 'req-123',
        decision: 'approve',
        comment: 'Looks good!',
      },
    };

    await ws.send(JSON.stringify(response));

    await waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith(response.payload);
    });
  });

  it('should handle WebSocket reconnection', async () => {
    render(<EventHandlers sessionId="session-123" handlers={mockHandlers} />);

    const ws = MockWebSocket.instances[0];

    // Simulate connection loss
    ws.readyState = 3; // CLOSED
    ws.onclose();

    await waitFor(() => {
      expect(MockWebSocket.instances).toHaveLength(2); // New connection created
    });
  });

  it('should handle malformed messages gracefully', async () => {
    const onError = jest.fn();
    render(<EventHandlers sessionId="session-123" handlers={mockHandlers} onError={onError} />);

    const ws = MockWebSocket.instances[0];

    // Send malformed JSON
    ws.onmessage({ data: 'invalid json' });

    await waitFor(() => {
      expect(onError).toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith('Failed to parse message:', expect.any(Error));
    });
  });
});

describe('WorkflowManager Component', () => {
  const mockWorkflow = {
    id: 'workflow-456',
    name: 'Data Analysis Workflow',
    status: 'running',
    currentStep: 2,
    steps: [
      { id: 'step-1', name: 'Load Data', status: 'completed' },
      { id: 'step-2', name: 'Analyze Data', status: 'running' },
      { id: 'step-3', name: 'Generate Dashboard', status: 'pending' },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should display workflow progress', () => {
    render(<WorkflowManager workflow={mockWorkflow} />);

    expect(screen.getByText('Data Analysis Workflow')).toBeInTheDocument();
    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('should show step completion status', () => {
    render(<WorkflowManager workflow={mockWorkflow} />);

    const completedStep = screen.getByText('Load Data');
    const runningStep = screen.getByText('Analyze Data');
    const pendingStep = screen.getByText('Generate Dashboard');

    expect(completedStep.closest('.step')).toHaveClass('completed');
    expect(runningStep.closest('.step')).toHaveClass('running');
    expect(pendingStep.closest('.step')).toHaveClass('pending');
  });

  it('should handle workflow pause/resume', async () => {
    const onPause = jest.fn();
    const onResume = jest.fn();

    render(
      <WorkflowManager
        workflow={mockWorkflow}
        onPause={onPause}
        onResume={onResume}
      />
    );

    const pauseButton = screen.getByText('Pause');
    fireEvent.click(pauseButton);

    await waitFor(() => {
      expect(onPause).toHaveBeenCalledWith(mockWorkflow.id);
    });

    // Simulate workflow being paused
    const pausedWorkflow = { ...mockWorkflow, status: 'paused' };
    render(<WorkflowManager workflow={pausedWorkflow} onResume={onResume} />);

    const resumeButton = screen.getByText('Resume');
    fireEvent.click(resumeButton);

    await waitFor(() => {
      expect(onResume).toHaveBeenCalledWith(mockWorkflow.id);
    });
  });

  it('should display human input prompts', async () => {
    const workflowWithInput = {
      ...mockWorkflow,
      requiresInput: true,
      inputPrompt: {
        message: 'Please confirm the analysis parameters',
        options: ['Confirm', 'Modify', 'Cancel'],
      },
    };

    render(<WorkflowManager workflow={workflowWithInput} />);

    expect(screen.getByText('Please confirm the analysis parameters')).toBeInTheDocument();
    expect(screen.getByText('Confirm')).toBeInTheDocument();
    expect(screen.getByText('Modify')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('should handle user input submission', async () => {
    const onInputSubmit = jest.fn();
    const workflowWithInput = {
      ...mockWorkflow,
      requiresInput: true,
      inputPrompt: {
        message: 'Please confirm the analysis parameters',
        options: ['Confirm', 'Modify', 'Cancel'],
      },
    };

    render(
      <WorkflowManager
        workflow={workflowWithInput}
        onInputSubmit={onInputSubmit}
      />
    );

    const confirmButton = screen.getByText('Confirm');
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(onInputSubmit).toHaveBeenCalledWith({
        workflowId: mockWorkflow.id,
        input: 'Confirm',
      });
    });
  });

  it('should display error states', () => {
    const errorWorkflow = {
      ...mockWorkflow,
      status: 'error',
      error: {
        message: 'Data processing failed',
        stepId: 'step-2',
      },
    };

    render(<WorkflowManager workflow={errorWorkflow} />);

    expect(screen.getByText('Error')).toBeInTheDocument();
    expect(screen.getByText('Data processing failed')).toBeInTheDocument();
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });

  it('should handle workflow cancellation', async () => {
    const onCancel = jest.fn();

    render(
      <WorkflowManager
        workflow={mockWorkflow}
        onCancel={onCancel}
      />
    );

    const cancelButton = screen.getByText('Cancel');
    fireEvent.click(cancelButton);

    await waitFor(() => {
      expect(onCancel).toHaveBeenCalledWith(mockWorkflow.id);
    });
  });
});