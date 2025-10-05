import React, { useState, useEffect, useCallback } from 'react';
import WorkflowManager, { WorkflowProgress } from './components/WorkflowManager';
import EventHandlers, { useEventHandlers } from './components/EventHandlers';
import UIContainer from './components/UIContainer';
import { apiService } from './services/api';
import { aguiEventService, AGUI_EVENTS } from './services/events';

/**
 * Main App Component - GUI-LOP Frontend
 * Orchestrates workflow management, UI containers, and event handling
 */
const App = () => {
  const [sessionId, setSessionId] = useState(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [error, setError] = useState(null);
  const [uiType, setUiType] = useState('streamlit');
  const [appConfig, setAppConfig] = useState({
    title: 'GUI-LOP - Generative UI Platform',
    debugMode: process.env.NODE_ENV === 'development'
  });

  // Initialize application and session
  const initializeApp = useCallback(async () => {
    try {
      setError(null);

      // Health check
      await apiService.healthCheck();

      // Create new session
      const sessionData = await apiService.initializeSession({
        type: 'gui-lop',
        capabilities: ['streamlit', 'gradio', 'hitl'],
        preferences: {
          theme: 'light',
          autoApprove: false,
          debugMode: appConfig.debugMode
        }
      });

      setSessionId(sessionData.id);
      setIsInitialized(true);

      console.log('GUI-LOP Frontend initialized with session:', sessionData.id);
    } catch (err) {
      console.error('Failed to initialize app:', err);
      setError(err.message || 'Failed to initialize application');
    }
  }, [appConfig.debugMode]);

  // Handle workflow events
  const handleWorkflowStateChange = useCallback((workflowState) => {
    console.log('Workflow state changed:', workflowState);

    // Auto-generate UI when workflow starts specific steps
    if (workflowState.state === 'running' && workflowState.step?.requiresUI) {
      handleGenerateUI(workflowState.step.uiConfig);
    }
  }, []);

  const handleStepComplete = useCallback((stepId, result) => {
    console.log('Step completed:', stepId, result);
  }, []);

  const handleWorkflowComplete = useCallback((results) => {
    console.log('Workflow completed:', results);

    // Show completion message
    aguiEventService.emit({
      type: AGUI_EVENTS.DATA_DISPLAY,
      sessionId,
      payload: {
        data: { results, status: 'completed' },
        displayConfig: {
          type: 'completion',
          title: 'Workflow Completed Successfully'
        }
      }
    });
  }, [sessionId]);

  // Handle AG-UI events
  const handleToolInput = useCallback((payload) => {
    console.log('Tool input requested:', payload);
    // This would typically show a modal or form for user input
  }, []);

  const handleApproval = useCallback((payload) => {
    console.log('Approval requested:', payload);
    // This would typically show an approval dialog
  }, []);

  const handleDataDisplay = useCallback((payload) => {
    console.log('Data display requested:', payload);
    // Handle data visualization requests
  }, []);

  const handleWorkflowState = useCallback((payload) => {
    console.log('Workflow state update:', payload);
  }, []);

  const handleError = useCallback((error, context) => {
    console.error('Error in workflow:', error, context);
    setError(error.message || 'An error occurred');
  }, []);

  // Generate dynamic UI
  const handleGenerateUI = useCallback(async (uiConfig) => {
    if (!sessionId) return;

    try {
      const uiData = await apiService.generateUI(sessionId, {
        type: uiConfig.type || 'dashboard',
        config: uiConfig,
        timestamp: new Date().toISOString()
      });

      console.log('UI generated:', uiData);
    } catch (error) {
      console.error('Failed to generate UI:', error);
    }
  }, [sessionId]);

  // Start example workflow
  const startExampleWorkflow = useCallback(async () => {
    if (!sessionId) return;

    try {
      const workflowConfig = {
        name: 'Example Data Analysis Workflow',
        type: 'data-analysis',
        steps: [
          {
            id: 'load-data',
            name: 'Load Data',
            requiresUI: true,
            uiConfig: {
              type: 'data-loader',
              title: 'Select Data Source'
            }
          },
          {
            id: 'analyze-data',
            name: 'Analyze Data',
            requiresUI: true,
            uiConfig: {
              type: 'analysis-dashboard',
              title: 'Data Analysis Results'
            }
          },
          {
            id: 'generate-insights',
            name: 'Generate Insights',
            requiresUI: true,
            uiConfig: {
              type: 'insights-display',
              title: 'Generated Insights'
            }
          }
        ],
        checkpoints: [
          {
            id: 'data-validation',
            description: 'Please validate the loaded data before proceeding',
            requiresHumanInteraction: true,
            step: 'load-data'
          }
        ]
      };

      await apiService.startWorkflow(sessionId, workflowConfig);
    } catch (error) {
      console.error('Failed to start workflow:', error);
      setError(error.message || 'Failed to start workflow');
    }
  }, [sessionId]);

  // Reset application
  const resetApp = useCallback(() => {
    setSessionId(null);
    setIsInitialized(false);
    setError(null);
    setAppConfig(prev => ({ ...prev, debugMode: process.env.NODE_ENV === 'development' }));
  }, []);

  // Initialize on mount
  useEffect(() => {
    initializeApp();
  }, [initializeApp]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (sessionId) {
        apiService.deleteSession(sessionId).catch(console.error);
      }
    };
  }, [sessionId]);

  if (error) {
    return (
      <div className="app-error">
        <div className="error-container">
          <h2>GUI-LOP Error</h2>
          <p>{error}</p>
          <button onClick={resetApp}>Reset Application</button>
        </div>

        <style jsx>{`
          .app-error {
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            background: #f8f9fa;
          }

          .error-container {
            text-align: center;
            padding: 32px;
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
            max-width: 500px;
          }

          .error-container h2 {
            color: #dc3545;
            margin-bottom: 16px;
          }

          .error-container button {
            background: #007bff;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
          }
        `}</style>
      </div>
    );
  }

  if (!isInitialized) {
    return (
      <div className="app-loading">
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <h2>Initializing GUI-LOP</h2>
          <p>Setting up your generative UI environment...</p>
        </div>

        <style jsx>{`
          .app-loading {
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            background: #f8f9fa;
          }

          .loading-container {
            text-align: center;
            padding: 32px;
          }

          .loading-spinner {
            width: 48px;
            height: 48px;
            border: 4px solid #f3f3f3;
            border-top: 4px solid #007bff;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin: 0 auto 24px;
          }

          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }

          .loading-container h2 {
            margin: 0 0 8px 0;
            color: #333;
          }

          .loading-container p {
            margin: 0;
            color: #666;
          }
        `}</style>
      </div>
    );
  }

  return (
    <WorkflowManager
      sessionId={sessionId}
      onStateChange={handleWorkflowStateChange}
      onStepComplete={handleStepComplete}
      onWorkflowComplete={handleWorkflowComplete}
    >
      <EventHandlers
        sessionId={sessionId}
        onToolInput={handleToolInput}
        onApproval={handleApproval}
        onDataDisplay={handleDataDisplay}
        onWorkflowState={handleWorkflowState}
        onError={handleError}
      >
        <div className="app">
          {/* Header */}
          <header className="app-header">
            <div className="header-content">
              <h1>{appConfig.title}</h1>
              <div className="header-controls">
                <select
                  value={uiType}
                  onChange={(e) => setUiType(e.target.value)}
                  className="ui-type-selector"
                >
                  <option value="streamlit">Streamlit</option>
                  <option value="gradio">Gradio</option>
                  <option value="custom">Custom</option>
                </select>
                <button
                  onClick={startExampleWorkflow}
                  className="start-workflow-btn"
                >
                  Start Example Workflow
                </button>
                <button
                  onClick={resetApp}
                  className="reset-btn"
                >
                  Reset
                </button>
              </div>
            </div>
          </header>

          {/* Workflow Progress */}
          <div className="workflow-section">
            <WorkflowProgress />
          </div>

          {/* Main Content */}
          <main className="app-main">
            <div className="ui-container-wrapper">
              <UIContainer
                sessionId={sessionId}
                uiType={uiType}
                onEvent={aguiEventService.emit}
                onError={handleError}
              />
            </div>
          </main>

          {/* Debug Info */}
          {appConfig.debugMode && (
            <div className="debug-info">
              <h3>Debug Information</h3>
              <p><strong>Session ID:</strong> {sessionId}</p>
              <p><strong>UI Type:</strong> {uiType}</p>
              <p><strong>Event History:</strong> {aguiEventService.eventHistory.length} events</p>
            </div>
          )}
        </div>

        <style jsx global>{`
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }

          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen',
              'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue',
              sans-serif;
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
            background-color: #f8f9fa;
          }

          .app {
            min-height: 100vh;
            display: flex;
            flex-direction: column;
          }

          .app-header {
            background: white;
            border-bottom: 1px solid #dee2e6;
            padding: 16px 24px;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
          }

          .header-content {
            max-width: 1200px;
            margin: 0 auto;
            display: flex;
            justify-content: space-between;
            align-items: center;
          }

          .header-content h1 {
            color: #333;
            font-size: 24px;
            font-weight: 600;
          }

          .header-controls {
            display: flex;
            gap: 12px;
            align-items: center;
          }

          .ui-type-selector {
            padding: 8px 12px;
            border: 1px solid #ced4da;
            border-radius: 4px;
            background: white;
            font-size: 14px;
          }

          .start-workflow-btn {
            background: #28a745;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
          }

          .start-workflow-btn:hover {
            background: #218838;
          }

          .reset-btn {
            background: #6c757d;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
          }

          .reset-btn:hover {
            background: #5a6268;
          }

          .workflow-section {
            padding: 16px 24px;
            max-width: 1200px;
            margin: 0 auto;
            width: 100%;
          }

          .app-main {
            flex: 1;
            padding: 0 24px 24px;
            max-width: 1200px;
            margin: 0 auto;
            width: 100%;
          }

          .ui-container-wrapper {
            height: calc(100vh - 300px);
            min-height: 400px;
          }

          .debug-info {
            background: #f8f9fa;
            border: 1px solid #dee2e6;
            border-radius: 4px;
            padding: 16px;
            margin: 16px 24px;
            font-family: monospace;
            font-size: 12px;
          }

          .debug-info h3 {
            margin: 0 0 8px 0;
            font-size: 14px;
          }

          .debug-info p {
            margin: 4px 0;
          }
        `}</style>
      </EventHandlers>
    </WorkflowManager>
  );
};

export default App;