import React, { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from './useAuth.js';

/**
 * Login screen — minimal but uses the v1 auth API via the AuthContext.
 * Older `LoginForm` lives under `components/auth/`; this is the routed
 * page entry-point feature code should mount.
 */
export default function Login() {
  const { login, isLoading, error: authError } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const next = params.get('next') || location.state?.from?.pathname || '/workflows';

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await login({ email: identifier, password });
      if (result.success) {
        navigate(next, { replace: true });
      } else {
        setError(result.error || 'Login failed');
      }
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-page" data-testid="login-page">
      <h2>Sign in</h2>
      {(error || authError) && (
        <div className="auth-error" role="alert" data-testid="login-error">
          {error || authError}
        </div>
      )}
      <form onSubmit={handleSubmit} className="auth-form">
        <label>
          Email or username
          <input
            type="text"
            name="identifier"
            data-testid="login-identifier"
            autoComplete="username"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            name="password"
            data-testid="login-password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <button type="submit" data-testid="login-submit" disabled={submitting || isLoading}>
          {submitting ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
      <p>
        Need an account? <Link to="/register">Register</Link>
      </p>
    </div>
  );
}
