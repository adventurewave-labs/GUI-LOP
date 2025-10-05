import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';

const App = () => {
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

  // WebSocket connection
  useEffect(() => {
    if (serverStatus !== 'connected') return;

    const ws = new WebSocket('ws://localhost:3001');

    ws.onopen = () => {
      setWsConnected(true);
      addLog('WebSocket connected');
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      addLog(`Event: ${data.type}`);

      if (data.type === 'ui_generation') {
        addLog(`UI ready: ${data.payload.ui_url}`);
      } else if (data.type === 'workflow_completed') {
        addLog('Workflow completed');
        setActiveWorkflow(prev => prev ? { ...prev, status: 'completed' } : null);
      }
    };

    ws.onclose = () => {
      setWsConnected(false);
    };

    return () => {
      ws.close();
    };
  }, [serverStatus]);

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

  return (
    <Router>
      <div className="app">
        {/* Header */}
        <header className="header">
          <div className="header-content">
            <h1>GUI-LOP - Generative UI Platform</h1>
            <div className="status-indicators">
              <span className={`status ${serverStatus}`}>
                Server: {serverStatus}
              </span>
              <span className={`status ${wsConnected ? 'connected' : 'disconnected'}`}>
                WS: {wsConnected ? 'Connected' : 'Disconnected'}
              </span>
            </div>
          </div>
        </header>

        {/* Navigation */}
        <nav className="nav">
          <Link to="/" className="nav-link">Dashboard</Link>
          <Link to="/workflows" className="nav-link">Workflows</Link>
          <Link to="/events" className="nav-link">Events</Link>
        </nav>

        {/* Main Content */}
        <main className="main">
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/workflows" element={<WorkflowsPage />} />
            <Route path="/events" element={<EventsPage />} />
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

        .header h1 {
          font-size: 1.5rem;
          color: #333;
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

export default App;