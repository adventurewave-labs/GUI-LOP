import React, { useEffect, useState } from 'react';
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  Link,
  NavLink,
  useNavigate,
} from 'react-router-dom';

import { AuthProvider, useAuth } from './contexts/AuthContext.jsx';
import { Login, Register, RefreshGuard } from './features/auth/index.js';
import {
  TemplatesList,
  CreateWorkflow,
  WorkflowDetail,
} from './features/workflows/index.js';
import { PendingStepsList, RespondForm } from './features/inbox/index.js';
import {
  ActiveWorkflows,
  WorkflowAnalytics,
  UserActivity,
} from './features/dashboards/index.js';
import { AdminPlaceholder } from './features/admin/index.js';
import { apiBaseUrl } from './services/api/client.js';

function HealthBadge() {
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch(`${apiBaseUrl}/health`);
        const data = await res.json();
        if (!cancelled) setStatus(data?.status === 'ok' ? 'connected' : 'error');
      } catch {
        if (!cancelled) setStatus('error');
      }
    };
    check();
    const id = setInterval(check, 10_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <span className={`status ${status}`} data-testid="server-status">
      Server: {status}
    </span>
  );
}

function Header() {
  const { isAuthenticated, user, logout } = useAuth();
  const navigate = useNavigate();
  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };
  return (
    <header className="header">
      <div className="header-content">
        <Link to="/" className="brand-link">
          <h1>GUI-LOP</h1>
        </Link>
        <div className="header-right">
          {isAuthenticated && user && (
            <div className="user-info">
              <span data-testid="user-display">
                Hi, {user.username || user.email || user.id}
              </span>
              <button
                type="button"
                className="logout-button"
                onClick={handleLogout}
                data-testid="logout-button"
              >
                Logout
              </button>
            </div>
          )}
          <HealthBadge />
        </div>
      </div>
    </header>
  );
}

function PrimaryNav() {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return null;
  return (
    <nav className="nav" aria-label="primary">
      <NavLink to="/workflows" className="nav-link">Workflows</NavLink>
      <NavLink to="/inbox" className="nav-link">Inbox</NavLink>
      <NavLink to="/dashboards/active" className="nav-link">Dashboards</NavLink>
      <NavLink to="/admin" className="nav-link">Admin</NavLink>
    </nav>
  );
}

function HomeRedirect() {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return <div role="status">Loading...</div>;
  return <Navigate to={isAuthenticated ? '/workflows' : '/login'} replace />;
}

function AppContent() {
  return (
    <Router>
      <div className="app">
        <Header />
        <PrimaryNav />
        <main className="main">
          <Routes>
            <Route path="/" element={<HomeRedirect />} />

            {/* Public routes */}
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />

            {/* Workflows */}
            <Route
              path="/workflows"
              element={
                <RefreshGuard>
                  <TemplatesList />
                </RefreshGuard>
              }
            />
            <Route
              path="/workflows/new"
              element={
                <RefreshGuard>
                  <CreateWorkflow />
                </RefreshGuard>
              }
            />
            <Route
              path="/workflows/:id"
              element={
                <RefreshGuard>
                  <WorkflowDetail />
                </RefreshGuard>
              }
            />

            {/* Inbox */}
            <Route
              path="/inbox"
              element={
                <RefreshGuard>
                  <PendingStepsList />
                </RefreshGuard>
              }
            />
            <Route
              path="/inbox/:workflowId/:stepId"
              element={
                <RefreshGuard>
                  <RespondForm />
                </RefreshGuard>
              }
            />

            {/* Dashboards */}
            <Route
              path="/dashboards/active"
              element={
                <RefreshGuard>
                  <ActiveWorkflows />
                </RefreshGuard>
              }
            />
            <Route
              path="/dashboards/analytics"
              element={
                <RefreshGuard>
                  <WorkflowAnalytics />
                </RefreshGuard>
              }
            />
            <Route
              path="/dashboards/me"
              element={
                <RefreshGuard>
                  <UserActivity />
                </RefreshGuard>
              }
            />
            <Route
              path="/dashboards"
              element={<Navigate to="/dashboards/active" replace />}
            />

            {/* Admin (placeholder) */}
            <Route
              path="/admin/*"
              element={
                <RefreshGuard>
                  <AdminPlaceholder />
                </RefreshGuard>
              }
            />

            {/* Catch-all */}
            <Route path="*" element={<HomeRedirect />} />
          </Routes>
        </main>
      </div>
      <AppStyles />
    </Router>
  );
}

function AppStyles() {
  return (
    <style>{`
      * { box-sizing: border-box; }
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        background: #f5f5f5;
        margin: 0;
      }
      .app { min-height: 100vh; display: flex; flex-direction: column; }
      .header { background: white; border-bottom: 1px solid #ddd; padding: 1rem 2rem; }
      .header-content {
        max-width: 1200px; margin: 0 auto;
        display: flex; justify-content: space-between; align-items: center;
      }
      .header h1 { margin: 0; font-size: 1.25rem; }
      .brand-link { text-decoration: none; color: inherit; }
      .header-right { display: flex; gap: 1rem; align-items: center; }
      .logout-button {
        background: #dc3545; color: white; border: none;
        padding: 0.375rem 0.75rem; border-radius: 4px; cursor: pointer;
      }
      .status {
        padding: 0.25rem 0.75rem; border-radius: 1rem;
        font-size: 0.875rem; font-weight: 500;
      }
      .status.connected { background: #d4edda; color: #155724; }
      .status.error { background: #f8d7da; color: #721c24; }
      .status.loading { background: #fff3cd; color: #856404; }
      .nav { background: #333; padding: 0 2rem; }
      .nav-link {
        display: inline-block; padding: 1rem 1.5rem;
        color: white; text-decoration: none;
        border-bottom: 3px solid transparent;
      }
      .nav-link.active { border-bottom-color: #007bff; }
      .main {
        flex: 1; padding: 2rem; max-width: 1200px;
        margin: 0 auto; width: 100%;
      }
      .auth-page { max-width: 420px; margin: 2rem auto; background: white; padding: 1.5rem; border-radius: 8px; }
      .auth-form { display: flex; flex-direction: column; gap: 0.75rem; }
      .auth-form label { display: flex; flex-direction: column; gap: 0.25rem; }
      .auth-form input, .auth-form textarea {
        padding: 0.5rem; border: 1px solid #ccc; border-radius: 4px; font-size: 1rem;
      }
      .auth-form button {
        padding: 0.625rem 1rem; background: #007bff; color: white;
        border: none; border-radius: 4px; cursor: pointer;
      }
      .auth-form button:disabled { opacity: 0.6; cursor: not-allowed; }
      .auth-error {
        background: #fee; color: #c33; padding: 0.5rem 0.75rem;
        border-radius: 4px; margin-bottom: 0.75rem; border: 1px solid #fcc;
      }
      .status-banner {
        background: #e7f3ff; padding: 0.75rem 1rem;
        border-radius: 4px; margin: 1rem 0; border: 1px solid #b8daff;
      }
      .form-group { display: flex; flex-direction: column; gap: 0.25rem; margin-bottom: 0.75rem; }
      .form-actions { display: flex; gap: 0.5rem; }
      .template-list { list-style: none; padding: 0; }
      .template-item { background: white; padding: 1rem; border-radius: 8px; margin-bottom: 0.75rem; }
    `}</style>
  );
}

const App = () => (
  <AuthProvider>
    <AppContent />
  </AuthProvider>
);

export default App;
