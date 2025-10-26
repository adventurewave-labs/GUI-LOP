import React, { useState, useEffect, useCallback } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import ProtectedRoute from './components/auth/ProtectedRoute';
import AuthPage from './components/auth/AuthPage';
import { createAuthenticatedWebSocket } from './services/api';

const AppContent = () => {
  const { isAuthenticated, user, logout, updateActivity } = useAuth();
  const [serverStatus, setServerStatus] = useState('loading');
  const [workflows, setWorkflows] = useState([]);
  const [activeWorkflow, setActiveWorkflow] = useState(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [logs, setLogs] = useState([]);

  const addLog = (message) => {
    setLogs(prev => [...prev, `${new Date().toLocaleTimeString()}: ${message}`]);
  };

  // Check server health
  useEffect(() => {
    const checkHealth = async () => {
      try {
        const response = await fetch('http://localhost:3001/health');
        const data = await response.json();
        if (data.status === 'ok') {
          setServerStatus('connected');
          addLog('Server connected');
        }
      } catch (error) {
        setServerStatus('error');
      }
    };

    checkHealth();
    const interval = setInterval(checkHealth, 5000);
    return () => clearInterval(interval);
  }, []);

  // Track user activity for auto-logout
  useEffect(() => {
    if (!isAuthenticated) return;

    const handleActivity = () => {
      updateActivity();
    };

    // Track various user activities
    const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart'];
    events.forEach(event => {
      window.addEventListener(event, handleActivity);
    });

    return () => {
      events.forEach(event => {
        window.removeEventListener(event, handleActivity);
      });
    };
  }, [isAuthenticated, updateActivity]);

  // Fetch workflow templates
  useEffect(() => {
    const fetchWorkflows = async () => {
      try {
        const response = await fetch('http://localhost:3001/api/workflows/templates');
        const data = await response.json();
        setWorkflows(data.templates || []);
      } catch (error) {
        // Silently handle errors
      }
    };

    if (serverStatus === 'connected') {
      fetchWorkflows();
    }
  }, [serverStatus]);

  // WebSocket connection with authentication
  useEffect(() => {
    if (serverStatus !== 'connected' || !isAuthenticated) return;

    let ws = null;
    let reconnectTimeout = null;
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 5;

    const connectWebSocket = () => {
      try {
        ws = createAuthenticatedWebSocket('ws://localhost:3001');

        ws.onopen = () => {
          setWsConnected(true);
          addLog('WebSocket connected');
          reconnectAttempts = 0; // Reset reconnect attempts on successful connection
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            addLog(`Event: ${data.type}`);

            if (data.type === 'ui_generation') {
              addLog(`UI ready: ${data.payload.ui_url}`);
            } else if (data.type === 'workflow_completed') {
              addLog('Workflow completed');
              setActiveWorkflow(prev => prev ? { ...prev, status: 'completed' } : null);
            } else if (data.type === 'auth_error') {
              addLog('Authentication error: WebSocket token expired');
              // Force logout on auth error
              logout();
            }
          } catch (error) {
            addLog('WebSocket message parsing error');
          }
        };

        ws.onclose = (event) => {
          setWsConnected(false);
          addLog(`WebSocket disconnected: ${event.code} - ${event.reason || 'Unknown reason'}`);

          // Attempt reconnection if it wasn't a clean close and we haven't exceeded max attempts
          if (event.code !== 1000 && reconnectAttempts < maxReconnectAttempts && isAuthenticated) {
            reconnectAttempts++;
            const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000); // Exponential backoff
            addLog(`Attempting to reconnect in ${delay / 1000} seconds...`);

            reconnectTimeout = setTimeout(connectWebSocket, delay);
          }
        };

        ws.onerror = (error) => {
          addLog('WebSocket connection error');
          console.error('WebSocket error:', error);
        };

      } catch (error) {
        addLog('Failed to create WebSocket connection');
        console.error('WebSocket creation error:', error);
      }
    };

    connectWebSocket();

    return () => {
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
      if (ws) {
        ws.close(1000, 'Component unmounted');
      }
    };
  }, [serverStatus, isAuthenticated, logout]);

  // Create workflow
  const createWorkflow = async (templateId) => {
    try {
      const response = await fetch('http://localhost:3001/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template: templateId,
          context: { task: `Demo ${templateId} workflow` }
        })
      });

      const data = await response.json();
      setActiveWorkflow(data);
      addLog(`Created: ${data.workflow_id}`);

      setTimeout(() => executeWorkflow(data.workflow_id), 1000);
    } catch (error) {
      addLog(`Create failed`);
    }
  };

  // Execute workflow
  const executeWorkflow = async (workflowId) => {
    try {
      const response = await fetch(`http://localhost:3001/api/workflows/${workflowId}/execute`, {
        method: 'POST'
      });

      const data = await response.json();
      setActiveWorkflow(prev => prev ? { ...prev, status: 'executing' } : null);
      addLog('Executing');
    } catch (error) {
      addLog('Execute failed');
    }
  };

  // Respond to workflow
  const respondToWorkflow = async (workflowId) => {
    try {
      const response = await fetch(`http://localhost:3001/api/workflows/${workflowId}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'approve',
          data: {
            insights: ['Data analysis complete', 'Patterns identified'],
            recommendations: ['Proceed with implementation']
          }
        })
      });

      addLog('Response submitted');
    } catch (error) {
      addLog('Response failed');
    }
  };

  // Handle user logout
  const handleLogout = useCallback(() => {
    logout();
    addLog('User logged out');
  }, [logout]);

  return (
    <Router>
      <div className="app">
        {/* Header */}
        <header className="header">
          <div className="header-content">
            <Link to="/" className="brand-link">
              <h1>GUI-LOP - Generative UI Platform</h1>
            </Link>
            <div className="header-right">
              {isAuthenticated && user && (
                <div className="user-info">
                  <span className="welcome-text">Welcome, {user.username || user.email}</span>
                  <button
                    className="logout-button"
                    onClick={handleLogout}
                    title="Logout"
                  >
                    Logout
                  </button>
                </div>
              )}
              <div className="status-indicators">
                <span className={`status ${serverStatus}`}>
                  Server: {serverStatus}
                </span>
                <span className={`status ${wsConnected ? 'connected' : 'disconnected'}`}>
                  WS: {wsConnected ? 'Connected' : 'Disconnected'}
                </span>
              </div>
            </div>
          </div>
        </header>

        {/* Navigation - Only show when authenticated */}
        {isAuthenticated && (
          <nav className="nav">
            <Link to="/" className="nav-link">Dashboard</Link>
            <Link to="/workflows" className="nav-link">Workflows</Link>
            <Link to="/events" className="nav-link">Events</Link>
          </nav>
        )}

        {/* Main Content */}
        <main className="main">
          <Routes>
            {/* Authentication Routes */}
            <Route
              path="/login"
              element={
                isAuthenticated ? (
                  <Navigate to="/" replace />
                ) : (
                  <AuthPage />
                )
              }
            />
            <Route
              path="/register"
              element={
                isAuthenticated ? (
                  <Navigate to="/" replace />
                ) : (
                  <AuthPage />
                )
              }
            />

            {/* Protected Routes */}
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <DashboardPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/workflows"
              element={
                <ProtectedRoute>
                  <WorkflowsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/events"
              element={
                <ProtectedRoute>
                  <EventsPage />
                </ProtectedRoute>
              }
            />

            {/* Fallback route - redirect to login if not authenticated */}
            <Route
              path="*"
              element={
                isAuthenticated ? (
                  <Navigate to="/" replace />
                ) : (
                  <Navigate to="/login" replace />
                )
              }
            />
          </Routes>
        </main>
      </div>

      <style jsx global>{`
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          background-color: #f5f5f5;
        }

        .app {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
        }

        .header {
          background: white;
          border-bottom: 1px solid #ddd;
          padding: 1rem 2rem;
        }

        .header-content {
          max-width: 1200px;
          margin: 0 auto;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .brand-link {
          text-decoration: none;
          color: inherit;
        }

        .brand-link:hover h1 {
          color: #007bff;
        }

        .header h1 {
          font-size: 1.5rem;
          color: #333;
          margin: 0;
          transition: color 0.2s ease;
        }

        .header-right {
          display: flex;
          align-items: center;
          gap: 1.5rem;
        }

        .user-info {
          display: flex;
          align-items: center;
          gap: 1rem;
        }

        .welcome-text {
          color: #666;
          font-size: 0.875rem;
          font-weight: 500;
        }

        .logout-button {
          background: #dc3545;
          color: white;
          border: none;
          padding: 0.375rem 0.75rem;
          border-radius: 4px;
          font-size: 0.875rem;
          cursor: pointer;
          transition: background-color 0.2s ease;
        }

        .logout-button:hover {
          background: #c82333;
        }

        .status-indicators {
          display: flex;
          gap: 1rem;
        }

        .status {
          padding: 0.25rem 0.75rem;
          border-radius: 1rem;
          font-size: 0.875rem;
          font-weight: 500;
        }

        .status.connected {
          background: #d4edda;
          color: #155724;
        }

        .status.error {
          background: #f8d7da;
          color: #721c24;
        }

        .status.loading {
          background: #fff3cd;
          color: #856404;
        }

        .status.disconnected {
          background: #f8d7da;
          color: #721c24;
        }

        .nav {
          background: #333;
          padding: 0 2rem;
        }

        .nav-link {
          display: inline-block;
          padding: 1rem 1.5rem;
          color: white;
          text-decoration: none;
          border-bottom: 3px solid transparent;
        }

        .nav-link:hover {
          background: #555;
          border-bottom-color: #007bff;
        }

        .main {
          flex: 1;
          padding: 2rem;
          max-width: 1200px;
          margin: 0 auto;
          width: 100%;
        }

        .card {
          background: white;
          border-radius: 8px;
          padding: 1.5rem;
          margin-bottom: 1rem;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }

        .card h2 {
          margin-bottom: 1rem;
          color: #333;
        }

        .btn {
          background: #007bff;
          color: white;
          border: none;
          padding: 0.5rem 1rem;
          border-radius: 4px;
          cursor: pointer;
          margin: 0.25rem;
        }

        .btn:hover {
          background: #0056b3;
        }

        .btn.success {
          background: #28a745;
        }

        .btn.success:hover {
          background: #1e7e34;
        }

        .workflow-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
          gap: 1rem;
          margin-bottom: 2rem;
        }

        .workflow-card {
          border: 1px solid #ddd;
          border-radius: 8px;
          padding: 1rem;
          background: white;
        }

        .workflow-card h3 {
          margin-bottom: 0.5rem;
          color: #333;
        }

        .workflow-card p {
          color: #666;
          margin-bottom: 1rem;
        }

        .active-workflow {
          background: #e7f3ff;
          border-color: #007bff;
        }

        .log-container {
          background: #1e1e1e;
          color: #fff;
          padding: 1rem;
          border-radius: 4px;
          font-family: monospace;
          font-size: 0.875rem;
          max-height: 400px;
          overflow-y: auto;
        }

        .log-entry {
          margin-bottom: 0.25rem;
          padding: 0.25rem 0;
        }

        .log-entry:nth-child(even) {
          background: rgba(255,255,255,0.05);
        }
      `}</style>
    </Router>
  );

  // Dashboard Page Component
  function DashboardPage() {
    return (
      <div>
        <div className="card">
          <h2>GUI-LOP Dashboard</h2>
          <p>Welcome to the Generative UI & Human-in-the-Loop Orchestration Platform</p>
          {user && (
            <p>Logged in as: <strong>{user.username || user.email}</strong></p>
          )}
          <p>Server Status: <strong>{serverStatus}</strong></p>
          <p>WebSocket: <strong>{wsConnected ? 'Connected' : 'Disconnected'}</strong></p>
        </div>

        {activeWorkflow && (
          <div className="card">
            <h2>Active Workflow</h2>
            <p><strong>ID:</strong> {activeWorkflow.workflow_id}</p>
            <p><strong>Status:</strong> {activeWorkflow.status}</p>
            <p><strong>Template:</strong> {activeWorkflow.template}</p>

            {activeWorkflow.status === 'waiting_for_human' && (
              <button
                className="btn success"
                onClick={() => respondToWorkflow(activeWorkflow.workflow_id)}
              >
                Approve & Complete
              </button>
            )}
          </div>
        )}

        <div className="card">
          <h2>Quick Actions</h2>
          {workflows.map(workflow => (
            <button
              key={workflow.id}
              className="btn"
              onClick={() => createWorkflow(workflow.id)}
            >
              Start {workflow.name}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Workflows Page Component
  function WorkflowsPage() {
    return (
      <div>
        <div className="card">
          <h2>Available Workflows</h2>
          <div className="workflow-grid">
            {workflows.map(workflow => (
              <div key={workflow.id} className="workflow-card">
                <h3>{workflow.name}</h3>
                <p>{workflow.description}</p>
                <button
                  className="btn"
                  onClick={() => createWorkflow(workflow.id)}
                >
                  Start Workflow
                </button>
              </div>
            ))}
          </div>
        </div>

        {activeWorkflow && (
          <div className="card active-workflow">
            <h2>Current Workflow</h2>
            <p><strong>Workflow ID:</strong> {activeWorkflow.workflow_id}</p>
            <p><strong>Template:</strong> {activeWorkflow.template}</p>
            <p><strong>Status:</strong> {activeWorkflow.status}</p>

            {activeWorkflow.status === 'waiting_for_human' && (
              <div>
                <p>The workflow is waiting for your approval. Click below to continue:</p>
                <button
                  className="btn success"
                  onClick={() => respondToWorkflow(activeWorkflow.workflow_id)}
                >
                  Approve & Continue
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // Events Page Component
  function EventsPage() {
    return (
      <div>
        <div className="card">
          <h2>Event Log</h2>
          <div className="log-container">
            {logs.length === 0 ? (
              <div className="log-entry">No events yet...</div>
            ) : (
              logs.map((log, index) => (
                <div key={index} className="log-entry">{log}</div>
              ))
            )}
          </div>
        </div>
      </div>
    );
  }
};

// Main App component with AuthProvider
const App = () => {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
};

export default App;