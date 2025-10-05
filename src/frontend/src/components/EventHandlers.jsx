import React, { useCallback, useState, useEffect } from 'react';
import { aguiEventService, AGUI_EVENTS } from '../services/events';

/**
 * EventHandlers - Component for handling AG-UI protocol events
 * Manages tool input requests, approval workflows, and data display
 */
const EventHandlers = ({
  sessionId,
  onToolInput,
  onApproval,
  onDataDisplay,
  onWorkflowState,
  onError,
  children
}) => {
  const [pendingApprovals, setPendingApprovals] = useState([]);
  const [toolInputRequests, setToolInputRequests] = useState([]);
  const [dataDisplays, setDataDisplays] = useState([]);
  const [workflowState, setWorkflowState] = useState(null);

  // Handle tool input requests
  const handleToolInputRequest = useCallback((event) => {
    console.log('Tool input request:', event);

    const { toolId, toolConfig, inputSchema, requestId } = event.payload;

    // Add to pending requests
    setToolInputRequests(prev => [...prev, {
      id: requestId,
      toolId,
      toolConfig,
      inputSchema,
      timestamp: event.timestamp
    }]);

    // Notify parent component
    onToolInput?.(event.payload);
  }, [onToolInput]);

  // Handle approval requests
  const handleApprovalRequest = useCallback((event) => {
    console.log('Approval request:', event);

    const { message, options, requestId, timeout } = event.payload;

    // Add to pending approvals
    const approval = {
      id: requestId,
      message,
      options,
      timeout,
      timestamp: event.timestamp,
      expiresAt: Date.now() + timeout
    };

    setPendingApprovals(prev => [...prev, approval]);

    // Auto-expire approvals
    setTimeout(() => {
      setPendingApprovals(prev => prev.filter(a => a.id !== requestId));
    }, timeout);

    // Notify parent component
    onApproval?.(event.payload);
  }, [onApproval]);

  // Handle data display requests
  const handleDataDisplay = useCallback((event) => {
    console.log('Data display request:', event);

    const { data, displayConfig, requestId } = event.payload;

    // Add to data displays
    setDataDisplays(prev => [...prev, {
      id: requestId,
      data,
      displayConfig,
      timestamp: event.timestamp
    }]);

    // Notify parent component
    onDataDisplay?.(event.payload);
  }, [onDataDisplay]);

  // Handle workflow state updates
  const handleWorkflowState = useCallback((event) => {
    console.log('Workflow state update:', event);

    const { state, step, metadata } = event.payload;
    setWorkflowState({ state, step, metadata, timestamp: event.timestamp });

    // Notify parent component
    onWorkflowState?.(event.payload);
  }, [onWorkflowState]);

  // Handle error events
  const handleError = useCallback((event) => {
    console.error('AG-UI Error event:', event);

    const { error, context } = event.payload;
    onError?.(error, context);
  }, [onError]);

  // Respond to tool input request
  const respondToToolInput = useCallback((requestId, input) => {
    const responseEvent = {
      type: AGUI_EVENTS.TOOL_INPUT_RESPONSE,
      sessionId,
      payload: {
        requestId,
        input,
        timestamp: new Date().toISOString()
      }
    };

    aguiEventService.emit(responseEvent);

    // Remove from pending requests
    setToolInputRequests(prev => prev.filter(req => req.id !== requestId));
  }, [sessionId]);

  // Respond to approval request
  const respondToApproval = useCallback((requestId, approved, additionalData = {}) => {
    const responseEvent = {
      type: AGUI_EVENTS.APPROVAL_RESPONSE,
      sessionId,
      payload: {
        requestId,
        approved,
        ...additionalData,
        timestamp: new Date().toISOString()
      }
    };

    aguiEventService.emit(responseEvent);

    // Remove from pending approvals
    setPendingApprovals(prev => prev.filter(approval => approval.id !== requestId));
  }, [sessionId]);

  // Register event handlers
  useEffect(() => {
    const unregisterFunctions = [
      aguiEventService.registerEventHandler(AGUI_EVENTS.TOOL_INPUT_REQUEST, handleToolInputRequest),
      aguiEventService.registerEventHandler(AGUI_EVENTS.APPROVAL_REQUEST, handleApprovalRequest),
      aguiEventService.registerEventHandler(AGUI_EVENTS.DATA_DISPLAY, handleDataDisplay),
      aguiEventService.registerEventHandler(AGUI_EVENTS.WORKFLOW_STATE, handleWorkflowState),
      aguiEventService.registerEventHandler(AGUI_EVENTS.ERROR, handleError)
    ];

    return () => {
      unregisterFunctions.forEach(unregister => unregister());
    };
  }, [
    handleToolInputRequest,
    handleApprovalRequest,
    handleDataDisplay,
    handleWorkflowState,
    handleError
  ]);

  // Cleanup expired items
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();

      setPendingApprovals(prev => prev.filter(approval => approval.expiresAt > now));
      setToolInputRequests(prev => prev.filter(req => {
        // Remove requests older than 5 minutes
        return now - new Date(req.timestamp).getTime() < 300000;
      }));
      setDataDisplays(prev => prev.filter(display => {
        // Remove displays older than 10 minutes
        return now - new Date(display.timestamp).getTime() < 600000;
      }));
    }, 30000); // Check every 30 seconds

    return () => clearInterval(interval);
  }, []);

  const contextValue = {
    pendingApprovals,
    toolInputRequests,
    dataDisplays,
    workflowState,
    respondToToolInput,
    respondToApproval,
    clearPendingApprovals: () => setPendingApprovals([]),
    clearToolInputRequests: () => setToolInputRequests([]),
    clearDataDisplays: () => setDataDisplays([])
  };

  return (
    <EventHandlersContext.Provider value={contextValue}>
      {children}

      {/* Debug overlay for development */}
      {process.env.NODE_ENV === 'development' && (
        <DebugOverlay
          pendingApprovals={pendingApprovals}
          toolInputRequests={toolInputRequests}
          dataDisplays={dataDisplays}
          workflowState={workflowState}
        />
      )}
    </EventHandlersContext.Provider>
  );
};

// Context for sharing event handler state
const EventHandlersContext = React.createContext();

/**
 * Hook for accessing event handler functionality
 */
export const useEventHandlers = () => {
  const context = React.useContext(EventHandlersContext);
  if (!context) {
    throw new Error('useEventHandlers must be used within EventHandlers');
  }
  return context;
};

/**
 * Debug overlay component for development
 */
const DebugOverlay = ({ pendingApprovals, toolInputRequests, dataDisplays, workflowState }) => {
  const [isVisible, setIsVisible] = useState(false);

  if (!isVisible) {
    return (
      <button
        onClick={() => setIsVisible(true)}
        style={{
          position: 'fixed',
          bottom: '20px',
          right: '20px',
          background: '#007bff',
          color: 'white',
          border: 'none',
          borderRadius: '50%',
          width: '40px',
          height: '40px',
          cursor: 'pointer',
          zIndex: 1000
        }}
      >
        🔍
      </button>
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: '20px',
        right: '20px',
        width: '400px',
        maxHeight: '80vh',
        background: 'white',
        border: '1px solid #ccc',
        borderRadius: '8px',
        padding: '16px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        zIndex: 1000,
        overflow: 'auto'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h3 style={{ margin: 0 }}>AG-UI Debug</h3>
        <button
          onClick={() => setIsVisible(false)}
          style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer' }}
        >
          ×
        </button>
      </div>

      {/* Workflow State */}
      {workflowState && (
        <div style={{ marginBottom: '16px', padding: '8px', background: '#e8f5e8', borderRadius: '4px' }}>
          <h4 style={{ margin: '0 0 4px 0' }}>Workflow State</h4>
          <p style={{ margin: 0, fontSize: '12px' }}>
            State: <strong>{workflowState.state}</strong><br />
            Step: <strong>{workflowState.step}</strong><br />
            Time: {new Date(workflowState.timestamp).toLocaleTimeString()}
          </p>
        </div>
      )}

      {/* Pending Approvals */}
      <div style={{ marginBottom: '16px' }}>
        <h4 style={{ margin: '0 0 8px 0' }}>Pending Approvals ({pendingApprovals.length})</h4>
        {pendingApprovals.map(approval => (
          <div key={approval.id} style={{ padding: '8px', background: '#fff3cd', borderRadius: '4px', marginBottom: '4px' }}>
            <p style={{ margin: 0, fontSize: '12px' }}>
              <strong>{approval.message}</strong><br />
              Expires: {new Date(approval.expiresAt).toLocaleTimeString()}
            </p>
          </div>
        ))}
      </div>

      {/* Tool Input Requests */}
      <div style={{ marginBottom: '16px' }}>
        <h4 style={{ margin: '0 0 8px 0' }}>Tool Input Requests ({toolInputRequests.length})</h4>
        {toolInputRequests.map(request => (
          <div key={request.id} style={{ padding: '8px', background: '#d1ecf1', borderRadius: '4px', marginBottom: '4px' }}>
            <p style={{ margin: 0, fontSize: '12px' }}>
              <strong>Tool:</strong> {request.toolId}<br />
              <strong>Time:</strong> {new Date(request.timestamp).toLocaleTimeString()}
            </p>
          </div>
        ))}
      </div>

      {/* Data Displays */}
      <div style={{ marginBottom: '16px' }}>
        <h4 style={{ margin: '0 0 8px 0' }}>Data Displays ({dataDisplays.length})</h4>
        {dataDisplays.map(display => (
          <div key={display.id} style={{ padding: '8px', background: '#f8d7da', borderRadius: '4px', marginBottom: '4px' }}>
            <p style={{ margin: 0, fontSize: '12px' }}>
              <strong>Type:</strong> {display.displayConfig.type || 'Unknown'}<br />
              <strong>Time:</strong> {new Date(display.timestamp).toLocaleTimeString()}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
};

export default EventHandlers;