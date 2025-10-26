import React, { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

const ProtectedRoute = ({
  children,
  redirectTo = '/login',
  allowedRoles = [],
  requireVerification = false
}) => {
  const { isAuthenticated, isLoading, user } = useAuth();
  const location = useLocation();
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    // Small delay to allow authentication state to settle
    const timer = setTimeout(() => {
      setIsChecking(false);
    }, 100);

    return () => clearTimeout(timer);
  }, []);

  // Show loading spinner while checking authentication
  if (isLoading || isChecking) {
    return <LoadingSpinner />;
  }

  // Redirect to login if not authenticated
  if (!isAuthenticated) {
    return (
      <Navigate
        to={redirectTo}
        state={{ from: location }}
        replace
      />
    );
  }

  // Check role-based access if roles are specified
  if (allowedRoles.length > 0 && user) {
    const hasRequiredRole = allowedRoles.some(role =>
      user.roles?.includes(role) || user.role === role
    );

    if (!hasRequiredRole) {
      return <AccessDenied />;
    }
  }

  // Check email verification if required
  if (requireVerification && user && !user.isEmailVerified) {
    return <EmailVerificationRequired />;
  }

  // User is authenticated and authorized
  return children;
};

// Loading spinner component
const LoadingSpinner = () => (
  <div className="auth-loading">
    <div className="spinner"></div>
    <p>Loading...</p>

    <style jsx>{`
      .auth-loading {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-height: 60vh;
        gap: 1rem;
      }

      .spinner {
        width: 40px;
        height: 40px;
        border: 4px solid #f3f3f3;
        border-top: 4px solid #007bff;
        border-radius: 50%;
        animation: spin 1s linear infinite;
      }

      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }

      .auth-loading p {
        color: #666;
        font-size: 1rem;
        margin: 0;
      }
    `}</style>
  </div>
);

// Access denied component
const AccessDenied = () => (
  <div className="access-denied">
    <div className="access-denied-content">
      <h2>Access Denied</h2>
      <p>You don't have permission to access this page.</p>
      <button
        className="back-button"
        onClick={() => window.history.back()}
      >
        Go Back
      </button>
    </div>

    <style jsx>{`
      .access-denied {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 60vh;
        padding: 2rem;
      }

      .access-denied-content {
        text-align: center;
        max-width: 400px;
      }

      .access-denied-content h2 {
        color: #dc3545;
        font-size: 1.75rem;
        margin-bottom: 1rem;
      }

      .access-denied-content p {
        color: #666;
        font-size: 1rem;
        margin-bottom: 1.5rem;
      }

      .back-button {
        background: #007bff;
        color: white;
        border: none;
        padding: 0.75rem 1.5rem;
        border-radius: 6px;
        cursor: pointer;
        font-size: 1rem;
        transition: background-color 0.2s ease;
      }

      .back-button:hover {
        background: #0056b3;
      }
    `}</style>
  </div>
);

// Email verification required component
const EmailVerificationRequired = () => (
  <div className="verification-required">
    <div className="verification-content">
      <h2>Email Verification Required</h2>
      <p>Please verify your email address to access this page.</p>
      <p>Check your inbox for a verification email.</p>
      <div className="verification-actions">
        <button
          className="resend-button"
          onClick={() => {
            // TODO: Implement resend verification email functionality
            console.log('Resend verification email');
          }}
        >
          Resend Verification Email
        </button>
        <button
          className="back-button"
          onClick={() => window.history.back()}
        >
          Go Back
        </button>
      </div>
    </div>

    <style jsx>{`
      .verification-required {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 60vh;
        padding: 2rem;
      }

      .verification-content {
        text-align: center;
        max-width: 400px;
      }

      .verification-content h2 {
        color: #ffc107;
        font-size: 1.75rem;
        margin-bottom: 1rem;
      }

      .verification-content p {
        color: #666;
        font-size: 1rem;
        margin-bottom: 0.5rem;
      }

      .verification-actions {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        margin-top: 1.5rem;
      }

      .resend-button, .back-button {
        padding: 0.75rem 1.5rem;
        border-radius: 6px;
        cursor: pointer;
        font-size: 1rem;
        transition: all 0.2s ease;
        border: none;
      }

      .resend-button {
        background: #ffc107;
        color: #212529;
      }

      .resend-button:hover {
        background: #e0a800;
      }

      .back-button {
        background: #6c757d;
        color: white;
      }

      .back-button:hover {
        background: #5a6268;
      }
    `}</style>
  </div>
);

export default ProtectedRoute;