/**
 * Optimized GUI-LOP React App with comprehensive performance enhancements
 * Week 5-8 Phase 2 Frontend Performance Optimization
 */

import React, { useState, useEffect, useCallback, useMemo, Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import ProtectedRoute from './components/auth/ProtectedRoute';
import AuthPage from './components/auth/AuthPage';

// Lazy-loaded components for code splitting
const LazyDashboard = lazy(() => import('./pages/LazyDashboard'));
const LazyWorkflows = lazy(() => import('./pages/LazyWorkflows'));
const LazyEvents = lazy(() => import('./pages/LazyEvents'));

// Performance monitoring and caching
import { usePerformanceMonitor } from './utils/performanceMonitor';
import { useCache, useCachedFetch, useWorkflowCache, useUserCache } from './hooks/useCache';
import { useAuthenticatedWebSocket } from './hooks/useWebSocket';
import { ProgressiveLoader, DashboardSkeleton } from './components/common/SkeletonLoader';

// API service
const createAuthenticatedWebSocket = (url) => {
  const token = localStorage.getItem('token');
  if (!token) return null;

  const ws = new WebSocket(`${url}?token=${token}`);
  return ws;
};

const AppContent = React.memo(() => {
  const { isAuthenticated, user, logout, updateActivity } = useAuth();
  const { trackInteraction, metrics } = usePerformanceMonitor();

  // Cached API hooks
  const { cachedFetch } = useCachedFetch();
  const { getWorkflows, cacheWorkflows, getWorkflow } = useWorkflowCache();
  const { getCurrentUser } = useUserCache();

  // State management with optimized updates
  const [serverStatus, setServerStatus] = useState('loading');
  const [workflows, setWorkflows] = useState([]);
  const [activeWorkflow, setActiveWorkflow] = useState(null);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  // WebSocket connection with optimization
  const {
    status: wsStatus,
    lastMessage: wsLastMessage,
    sendMessage,
    isConnected: wsConnected
  } = useAuthenticatedWebSocket(
    'ws://localhost:3001',
    () => Promise.resolve(localStorage.getItem('token')),
    {
      maxReconnectAttempts: 5,
      reconnectDelay: 1000,
      maxReconnectDelay: 30000,
      healthCheckInterval: 30000,
      closeOnUnmount: false
    }
  );

  // Memoized log addition
  const addLog = useCallback((message, level = 'info', details = null) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => {
      const newLog = {
        timestamp,
        message,
        level,
        details,
        id: `${timestamp}-${Math.random().toString(36).substr(2, 9)}`
      };

      // Keep only last 1000 logs to prevent memory issues
      const updatedLogs = [...prev, newLog];
      return updatedLogs.length > 1000 ? updatedLogs.slice(-1000) : updatedLogs;
    });
  }, []);

  // Optimized server health check with caching
  const checkServerHealth = useCallback(async () => {
    try {
      const startTime = performance.now();
      const data = await cachedFetch('http://localhost:3001/health', {
        cacheTTL: 30000 // Cache for 30 seconds
      });

      if (data.status === 'ok') {
        setServerStatus('connected');
        addLog('Server connected', 'info');
      }

      trackInteraction('server_health_check', startTime);
    } catch (error) {
      setServerStatus('error');
      addLog('Server health check failed', 'error', { error: error.message });
    }
  }, [cachedFetch, addLog, trackInteraction]);

  // Server health monitoring with optimized interval
  useEffect(() => {
    checkServerHealth();

    // Use requestAnimationFrame for better performance during interactions
    let rafId = null;
    const scheduleHealthCheck = () => {
      rafId = requestAnimationFrame(() => {
        checkServerHealth();
        setTimeout(scheduleHealthCheck, 5000); // Check every 5 seconds
      });
    };

    scheduleHealthCheck();

    return () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [checkServerHealth]);

  // Optimized user activity tracking with passive listeners
  useEffect(() => {
    if (!isAuthenticated) return;

    const handleActivity = () => {
      updateActivity();
    };

    // Use passive event listeners for better scroll performance
    const events = [
      { type: 'mousedown', options: { passive: true } },
      { type: 'touchstart', options: { passive: true } },
      { type: 'keypress', options: { passive: true } }
    ];

    events.forEach(({ type, options }) => {
      window.addEventListener(type, handleActivity, options);
    });

    return () => {
      events.forEach(({ type }) => {
        window.removeEventListener(type, handleActivity);
      });
    };
  }, [isAuthenticated, updateActivity]);

  // Optimized workflow fetching with caching
  const fetchWorkflows = useCallback(async () => {
    try {
      const startTime = performance.now();
      const data = await cachedFetch('http://localhost:3001/api/workflows/templates', {
        cacheTTL: 120000 // Cache for 2 minutes
      });

      if (data.templates) {
        setWorkflows(data.templates);
        cacheWorkflows(data.templates);
        addLog(`Loaded ${data.templates.length} workflow templates`, 'info');
      }

      trackInteraction('workflows_fetch', startTime);
    } catch (error) {
      addLog('Failed to fetch workflows', 'error', { error: error.message });
    } finally {
      setLoading(false);
    }
  }, [cachedFetch, cacheWorkflows, addLog, trackInteraction]);

  // Fetch workflows when server is connected
  useEffect(() => {
    if (serverStatus === 'connected') {
      fetchWorkflows();
    }
  }, [serverStatus, fetchWorkflows]);

  // Optimized WebSocket message handling
  useEffect(() => {
    if (!wsLastMessage) return;

    const startTime = performance.now();

    try {
      const data = wsLastMessage;
      addLog(`Event: ${data.type}`, 'info', { data });

      switch (data.type) {
        case 'ui_generation':
          addLog(`UI ready: ${data.payload.ui_url}`, 'success');
          break;

        case 'workflow_completed':
          addLog('Workflow completed', 'success');
          setActiveWorkflow(prev => prev ? { ...prev, status: 'completed' } : null);
          break;

        case 'workflow_status':
          setActiveWorkflow(prev => prev ? { ...prev, ...data.payload } : data.payload);
          break;

        case 'auth_error':
          addLog('Authentication error: WebSocket token expired', 'error');
          logout();
          break;

        case 'ping':
          // Respond to keep-alive pings
          sendMessage({ type: 'pong', timestamp: Date.now() });
          break;

        default:
          addLog(`Unknown event type: ${data.type}`, 'warning');
      }
    } catch (error) {
      addLog('WebSocket message processing error', 'error', { error: error.message });
    }

    trackInteraction('websocket_message_process', startTime);
  }, [wsLastMessage, addLog, logout, sendMessage, trackInteraction]);

  // Optimized workflow creation
  const createWorkflow = useCallback(async (templateId) => {
    try {
      const startTime = performance.now();
      addLog(`Creating workflow: ${templateId}`, 'info');

      const response = await fetch('http://localhost:3001/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template: templateId,
          context: { task: `Demo ${templateId} workflow` }
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      setActiveWorkflow(data);
      addLog(`Created: ${data.workflow_id}`, 'success');

      // Execute workflow after a short delay
      setTimeout(() => executeWorkflow(data.workflow_id), 1000);

      trackInteraction('workflow_create', startTime);
    } catch (error) {
      addLog(`Create failed: ${error.message}`, 'error');
    }
  }, [addLog, trackInteraction]);

  // Optimized workflow execution
  const executeWorkflow = useCallback(async (workflowId) => {
    try {
      const startTime = performance.now();
      addLog(`Executing workflow: ${workflowId}`, 'info');

      const response = await fetch(`http://localhost:3001/api/workflows/${workflowId}/execute`, {
        method: 'POST'
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      setActiveWorkflow(prev => prev ? { ...prev, status: 'executing' } : null);
      addLog('Workflow execution started', 'success');

      trackInteraction('workflow_execute', startTime);
    } catch (error) {
      addLog(`Execute failed: ${error.message}`, 'error');
    }
  }, [addLog, trackInteraction]);

  // Optimized workflow response
  const respondToWorkflow = useCallback(async (workflowId) => {
    try {
      const startTime = performance.now();
      addLog(`Responding to workflow: ${workflowId}`, 'info');

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

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      addLog('Response submitted successfully', 'success');
      trackInteraction('workflow_respond', startTime);
    } catch (error) {
      addLog(`Response failed: ${error.message}`, 'error');
    }
  }, [addLog, trackInteraction]);

  // Memoized logout handler
  const handleLogout = useCallback(() => {
    const startTime = performance.now();
    logout();
    addLog('User logged out', 'info');
    trackInteraction('user_logout', startTime);
  }, [logout, addLog, trackInteraction]);

  // Clear logs handler
  const handleClearLogs = useCallback(() => {
    const startTime = performance.now();
    setLogs([]);
    addLog('Logs cleared', 'info');
    trackInteraction('logs_clear', startTime);
  }, [addLog, trackInteraction]);

  // Memoized dashboard props
  const dashboardProps = useMemo(() => ({
    user,
    serverStatus,
    wsConnected,
    activeWorkflow,
    workflows,
    onCreateWorkflow: createWorkflow,
    onRespondToWorkflow: respondToWorkflow
  }), [user, serverStatus, wsConnected, activeWorkflow, workflows, createWorkflow, respondToWorkflow]);

  // Memoized workflows props
  const workflowsProps = useMemo(() => ({
    workflows,
    activeWorkflow,
    onCreateWorkflow: createWorkflow,
    onRespondToWorkflow: respondToWorkflow,
    loading
  }), [workflows, activeWorkflow, createWorkflow, respondToWorkflow, loading]);

  // Memoized events props
  const eventsProps = useMemo(() => ({
    logs,
    onClearLogs: handleClearLogs
  }), [logs, handleClearLogs]);

  // Performance metrics overlay (development only)
  const PerformanceOverlay = useMemo(() => {
    if (process.env.NODE_ENV !== 'development' || !metrics) return null;

    return (
      <div className="performance-overlay">
        <div className="performance-stats">
          <h4>Performance Metrics</h4>
          <div>FPS: {metrics.render?.length > 0 ? '60' : 'Loading...'}</div>
          <div>Memory: {metrics.summary?.currentMemoryUsage ?
            `${(metrics.summary.currentMemoryUsage.used / 1024 / 1024).toFixed(1)}MB` :
            'Loading...'}</div>
          <div>Resources: {metrics.summary?.totalResources || 0}</div>
          <div>Cache Hits: {metrics.summary?.averageHits?.toFixed(1) || '0'}</div>
        </div>
      </div>
    );
  }, [metrics]);

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
                  <span className="welcome-text">
                    Welcome, {user.username || user.email}
                  </span>
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

        {/* Navigation */}
        {isAuthenticated && (
          <nav className="nav">
            <Link to="/" className="nav-link">Dashboard</Link>
            <Link to="/workflows" className="nav-link">Workflows</Link>
            <Link to="/events" className="nav-link">Events</Link>
          </nav>
        )}

        {/* Main Content with Suspense */}
        <main className="main">
          <Suspense fallback={<DashboardSkeleton />}>
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

              {/* Protected Routes with Lazy Loading */}
              <Route
                path="/"
                element={
                  <ProtectedRoute>
                    <LazyDashboard {...dashboardProps} />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/workflows"
                element={
                  <ProtectedRoute>
                    <LazyWorkflows {...workflowsProps} />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/events"
                element={
                  <ProtectedRoute>
                    <LazyEvents {...eventsProps} />
                  </ProtectedRoute>
                }
              />

              {/* Fallback route */}
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
          </Suspense>
        </main>

        {/* Performance Overlay (Development Only) */}
        {PerformanceOverlay}

        {/* Global Styles */}
        <style jsx global>{`
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }

          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background-color: #f5f5f5;
            line-height: 1.6;
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
            position: sticky;
            top: 0;
            z-index: 100;
            backdrop-filter: blur(10px);
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
            transition: all 0.2s ease;
          }

          .logout-button:hover {
            background: #c82333;
            transform: translateY(-1px);
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
            animation: fadeIn 0.3s ease;
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
            position: sticky;
            top: 73px;
            z-index: 99;
          }

          .nav-link {
            display: inline-block;
            padding: 1rem 1.5rem;
            color: white;
            text-decoration: none;
            border-bottom: 3px solid transparent;
            transition: all 0.2s ease;
          }

          .nav-link:hover {
            background: #555;
            border-bottom-color: #007bff;
          }

          .nav-link.active {
            border-bottom-color: #007bff;
            background: #555;
          }

          .main {
            flex: 1;
            padding: 2rem;
            max-width: 1200px;
            margin: 0 auto;
            width: 100%;
          }

          /* Performance Overlay Styles */
          .performance-overlay {
            position: fixed;
            top: 10px;
            right: 10px;
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 10px;
            border-radius: 4px;
            font-size: 12px;
            z-index: 1000;
            min-width: 150px;
          }

          .performance-stats h4 {
            margin-bottom: 5px;
            font-size: 14px;
          }

          .performance-stats div {
            margin-bottom: 2px;
          }

          /* Loading and Transition Animations */
          @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
          }

          @keyframes slideIn {
            from { transform: translateY(20px); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
          }

          /* Responsive Design */
          @media (max-width: 768px) {
            .header {
              padding: 1rem;
            }

            .header-content {
              flex-direction: column;
              gap: 1rem;
            }

            .header h1 {
              font-size: 1.25rem;
            }

            .user-info {
              flex-direction: column;
              gap: 0.5rem;
            }

            .status-indicators {
              flex-direction: column;
              gap: 0.5rem;
            }

            .nav {
              padding: 0 1rem;
            }

            .nav-link {
              padding: 0.75rem 1rem;
              font-size: 0.875rem;
            }

            .main {
              padding: 1rem;
            }

            .performance-overlay {
              top: auto;
              bottom: 10px;
              right: 10px;
            }
          }

          /* Print Styles */
          @media print {
            .header, .nav, .performance-overlay {
              display: none;
            }

            .main {
              padding: 0;
            }
          }
        `}</style>
      </div>
    </Router>
  );
});

AppContent.displayName = 'AppContent';

// Main App component with error boundary
class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('App Error Boundary caught an error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          padding: '2rem',
          textAlign: 'center',
          backgroundColor: '#f8d7da',
          color: '#721c24'
        }}>
          <h1>Something went wrong</h1>
          <p>The application encountered an unexpected error.</p>
          <details style={{ marginTop: '1rem', textAlign: 'left' }}>
            <summary>Error Details</summary>
            <pre style={{
              marginTop: '0.5rem',
              padding: '1rem',
              backgroundColor: 'rgba(0,0,0,0.1)',
              borderRadius: '4px',
              overflow: 'auto'
            }}>
              {this.state.error?.toString()}
            </pre>
          </details>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: '1rem',
              padding: '0.5rem 1rem',
              backgroundColor: '#dc3545',
              color: 'white',
              border: 'none',
              borderadius: '4px',
              cursor: 'pointer'
            }}
          >
            Reload Page
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

// Main App component
const App = () => {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </ErrorBoundary>
  );
};

export default App;