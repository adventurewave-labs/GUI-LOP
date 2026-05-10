import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './useAuth.js';

/**
 * Wraps protected routes. If the AuthContext is still hydrating, renders a
 * lightweight loading marker; if unauthenticated, redirects to
 * `/login?next=<encoded current path>` so the user can be returned after
 * a successful sign-in.
 */
export default function RefreshGuard({ children }) {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="auth-loading" data-testid="auth-loading" role="status">
        Loading...
      </div>
    );
  }

  if (!isAuthenticated) {
    const next = encodeURIComponent(`${location.pathname}${location.search || ''}`);
    return <Navigate to={`/login?next=${next}`} replace />;
  }

  return children;
}
