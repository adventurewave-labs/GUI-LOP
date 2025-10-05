import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AGUI_EVENTS } from '../services/events';
import { apiService } from '../services/api';

/**
 * UIContainer - Host container for dynamically generated UIs
 * Supports Streamlit and Gradio applications through iframes
 * Handles AG-UI protocol events for real-time communication
 */
const UIContainer = ({
  sessionId,
  uiType = 'streamlit',
  onEvent,
  className = '',
  onError
}) => {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [uiUrl, setUiUrl] = useState('');
  const [eventHistory, setEventHistory] = useState([]);
  const iframeRef = useRef(null);
  const wsRef = useRef(null);

  // Generate UI URL based on type and session
  const generateUiUrl = useCallback(() => {
    const baseUrl = apiService.getBaseUrl();
    const timestamp = Date.now();

    switch (uiType) {
      case 'streamlit':
        return `${baseUrl}/streamlit/${sessionId}?t=${timestamp}`;
      case 'gradio':
        return `${baseUrl}/gradio/${sessionId}?t=${timestamp}`;
      default:
        return `${baseUrl}/ui/${sessionId}?t=${timestamp}`;
    }
  }, [sessionId, uiType]);

  // Initialize WebSocket connection for AG-UI events
  const initializeWebSocket = useCallback(() => {
    const wsUrl = apiService.getWebSocketUrl(sessionId);

    try {
      wsRef.current = new WebSocket(wsUrl);

      wsRef.current.onopen = () => {
        console.log(`WebSocket connected for session: ${sessionId}`);
      };

      wsRef.current.onmessage = (event) => {
        try {
          const aguiEvent = JSON.parse(event.data);
          handleAGUIEvent(aguiEvent);
        } catch (parseError) {
          console.error('Failed to parse AG-UI event:', parseError);
        }
      };

      wsRef.current.onerror = (errorEvent) => {
        console.error('WebSocket error:', errorEvent);
        setError('WebSocket connection failed');
        onError?.(errorEvent);
      };

      wsRef.current.onclose = () => {
        console.log('WebSocket connection closed');
        // Attempt reconnection after delay
        setTimeout(initializeWebSocket, 3000);
      };
    } catch (error) {
      console.error('Failed to initialize WebSocket:', error);
      setError('Failed to establish real-time connection');
    }
  }, [sessionId, onError]);

  // Handle incoming AG-UI events
  const handleAGUIEvent = useCallback((aguiEvent) => {
    console.log('Received AG-UI event:', aguiEvent);

    // Add to event history
    setEventHistory(prev => [...prev, { ...aguiEvent, timestamp: new Date() }]);

    // Handle specific event types
    switch (aguiEvent.type) {
      case AGUI_EVENTS.UI_UPDATE:
        // Update iframe content or URL
        if (aguiEvent.payload.refresh) {
          setUiUrl(generateUiUrl());
        }
        break;

      case AGUI_EVENTS.TOOL_INPUT_REQUEST:
        // Forward tool input request to parent
        onEvent?.(aguiEvent);
        break;

      case AGUI_EVENTS.APPROVAL_REQUEST:
        // Handle approval workflow
        onEvent?.(aguiEvent);
        break;

      case AGUI_EVENTS.DATA_DISPLAY:
        // Handle data visualization requests
        onEvent?.(aguiEvent);
        break;

      default:
        console.warn('Unknown AG-UI event type:', aguiEvent.type);
    }
  }, [generateUiUrl, onEvent]);

  // Send messages to the iframe (postMessage API)
  const sendMessageToIframe = useCallback((message) => {
    if (iframeRef.current && iframeRef.current.contentWindow) {
      iframeRef.current.contentWindow.postMessage(message, '*');
    }
  }, []);

  // Handle approval workflow
  const handleApproval = useCallback((approved, additionalData = {}) => {
    const approvalEvent = {
      type: AGUI_EVENTS.APPROVAL_RESPONSE,
      payload: {
        sessionId,
        approved,
        timestamp: new Date().toISOString(),
        ...additionalData
      }
    };

    // Send via WebSocket
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(approvalEvent));
    }

    // Also send via HTTP API as fallback
    apiService.sendApprovalResponse(sessionId, approved, additionalData)
      .catch(error => console.error('Failed to send approval response:', error));
  }, [sessionId]);

  // Handle tool input responses
  const handleToolInput = useCallback((input, toolId) => {
    const inputEvent = {
      type: AGUI_EVENTS.TOOL_INPUT_RESPONSE,
      payload: {
        sessionId,
        toolId,
        input,
        timestamp: new Date().toISOString()
      }
    };

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(inputEvent));
    }
  }, [sessionId]);

  // Initialize component
  useEffect(() => {
    setIsLoading(true);
    setError(null);

    const url = generateUiUrl();
    setUiUrl(url);

    initializeWebSocket();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [generateUiUrl, initializeWebSocket]);

  // Handle iframe load events
  const handleIframeLoad = useCallback(() => {
    setIsLoading(false);
    setError(null);

    // Send initialization message to iframe
    sendMessageToIframe({
      type: 'INITIALIZE',
      payload: { sessionId }
    });
  }, [sessionId, sendMessageToIframe]);

  // Handle iframe errors
  const handleIframeError = useCallback((error) => {
    setIsLoading(false);
    setError('Failed to load UI component');
    onError?.(error);
  }, [onError]);

  // Clear event history
  const clearEventHistory = useCallback(() => {
    setEventHistory([]);
  }, []);

  if (error) {
    return (
      <div className={`ui-container-error ${className}`}>
        <div className="error-content">
          <h3>UI Loading Error</h3>
          <p>{error}</p>
          <button onClick={() => setUiUrl(generateUiUrl())}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`ui-container ${className}`}>
      {/* Loading overlay */}
      {isLoading && (
        <div className="ui-loading-overlay">
          <div className="loading-spinner"></div>
          <p>Generating dynamic UI...</p>
        </div>
      )}

      {/* Main iframe for dynamic UI */}
      <iframe
        ref={iframeRef}
        src={uiUrl}
        className="ui-iframe"
        onLoad={handleIframeLoad}
        onError={handleIframeError}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        title="Dynamic UI Component"
      />

      {/* Event history for debugging */}
      {process.env.NODE_ENV === 'development' && eventHistory.length > 0 && (
        <div className="event-history">
          <h4>AG-UI Event History</h4>
          <button onClick={clearEventHistory}>Clear</button>
          <ul>
            {eventHistory.slice(-10).map((event, index) => (
              <li key={index}>
                <strong>{event.type}</strong>: {JSON.stringify(event.payload)}
                <small>{new Date(event.timestamp).toLocaleTimeString()}</small>
              </li>
            ))}
          </ul>
        </div>
      )}

      <style jsx>{`
        .ui-container {
          position: relative;
          width: 100%;
          height: 100%;
          min-height: 400px;
        }

        .ui-iframe {
          width: 100%;
          height: 100%;
          border: none;
          border-radius: 8px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        }

        .ui-loading-overlay {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          background: rgba(255, 255, 255, 0.9);
          z-index: 10;
        }

        .loading-spinner {
          width: 32px;
          height: 32px;
          border: 3px solid #f3f3f3;
          border-top: 3px solid #3498db;
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin-bottom: 16px;
        }

        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        .ui-container-error {
          padding: 32px;
          text-align: center;
          background: #fef5e7;
          border: 1px solid #f39c12;
          border-radius: 8px;
        }

        .error-content h3 {
          color: #e74c3c;
          margin: 0 0 8px 0;
        }

        .error-content button {
          background: #3498db;
          color: white;
          border: none;
          padding: 8px 16px;
          border-radius: 4px;
          cursor: pointer;
        }

        .event-history {
          margin-top: 16px;
          padding: 16px;
          background: #f8f9fa;
          border-radius: 4px;
          font-family: monospace;
          font-size: 12px;
        }

        .event-history h4 {
          margin: 0 0 8px 0;
        }

        .event-history ul {
          list-style: none;
          padding: 0;
          margin: 8px 0 0 0;
        }

        .event-history li {
          margin-bottom: 8px;
          padding: 8px;
          background: white;
          border-radius: 4px;
          border-left: 3px solid #3498db;
        }

        .event-history small {
          display: block;
          color: #666;
          margin-top: 4px;
        }
      `}</style>
    </div>
  );
};

export default UIContainer;