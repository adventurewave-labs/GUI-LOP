import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import LoginForm from './LoginForm';
import RegisterForm from './RegisterForm';
import AuthLayout from './AuthLayout';

const AuthPage = () => {
  const [currentForm, setCurrentForm] = useState('login');
  const navigate = useNavigate();
  const location = useLocation();

  // Get redirect path from location state
  const from = location.state?.from?.pathname || '/';

  const handleToggleForm = (form) => {
    setCurrentForm(form);
  };

  const handleAuthSuccess = (user) => {
    // Redirect to the intended page or dashboard
    navigate(from, { replace: true });
  };

  const renderForm = () => {
    switch (currentForm) {
      case 'register':
        return (
          <RegisterForm
            onToggleForm={handleToggleForm}
            onRegisterSuccess={handleAuthSuccess}
          />
        );
      case 'forgot-password':
        return (
          <ForgotPasswordForm
            onToggleForm={handleToggleForm}
            onSuccess={handleAuthSuccess}
          />
        );
      case 'login':
      default:
        return (
          <LoginForm
            onToggleForm={handleToggleForm}
            onLoginSuccess={handleAuthSuccess}
          />
        );
    }
  };

  const getPageTitle = () => {
    switch (currentForm) {
      case 'register':
        return 'Create Account';
      case 'forgot-password':
        return 'Reset Password';
      case 'login':
      default:
        return 'Welcome Back';
    }
  };

  const getPageSubtitle = () => {
    switch (currentForm) {
      case 'register':
        return 'Join GUI-LOP to start building amazing interfaces';
      case 'forgot-password':
        return 'Enter your email to reset your password';
      case 'login':
      default:
        return 'Sign in to your account to continue';
    }
  };

  return (
    <AuthLayout title={getPageTitle()} subtitle={getPageSubtitle()}>
      {renderForm()}
    </AuthLayout>
  );
};

// Forgot Password Form Component
const ForgotPasswordForm = ({ onToggleForm, onSuccess }) => {
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      // TODO: Implement forgot password API call
      // const response = await authAPI.requestPasswordReset(email);

      // For now, simulate success
      setSuccess(true);
      setTimeout(() => {
        onSuccess?.();
      }, 2000);
    } catch (error) {
      setError(error.message || 'Failed to send reset email');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="forgot-password-success">
        <div className="success-icon">✉️</div>
        <h3>Check Your Email</h3>
        <p>We've sent a password reset link to your email address.</p>
        <p className="email-note">{email}</p>
        <button
          className="auth-button primary"
          onClick={() => onToggleForm?.('login')}
        >
          Back to Login
        </button>

        <style jsx>{`
          .forgot-password-success {
            text-align: center;
            padding: 2rem 0;
          }

          .success-icon {
            font-size: 3rem;
            margin-bottom: 1rem;
          }

          .forgot-password-success h3 {
            color: #28a745;
            font-size: 1.5rem;
            margin-bottom: 1rem;
          }

          .forgot-password-success p {
            color: #666;
            font-size: 1rem;
            margin-bottom: 0.5rem;
          }

          .email-note {
            font-weight: 500;
            color: #333;
            padding: 0.5rem;
            background: #f8f9fa;
            border-radius: 6px;
            margin: 1rem 0;
          }

          .auth-button {
            width: 100%;
            padding: 0.875rem 1.5rem;
            border: none;
            border-radius: 6px;
            font-size: 1rem;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s ease;
          }

          .auth-button.primary {
            background: #007bff;
            color: white;
          }

          .auth-button.primary:hover {
            background: #0056b3;
          }
        `}</style>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="forgot-password-form">
      {error && (
        <div className="auth-error">
          {error}
        </div>
      )}

      <div className="form-group">
        <label htmlFor="email" className="form-label">
          Email Address
        </label>
        <input
          type="email"
          id="email"
          className="form-input"
          placeholder="Enter your email address"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          disabled={isSubmitting}
        />
      </div>

      <button
        type="submit"
        className="auth-button primary"
        disabled={!email || isSubmitting}
      >
        {isSubmitting ? 'Sending...' : 'Send Reset Link'}
      </button>

      <div className="form-footer">
        <button
          type="button"
          className="link-button"
          onClick={() => onToggleForm?.('login')}
        >
          Back to Login
        </button>
      </div>

      <style jsx>{`
        .forgot-password-form {
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
        }

        .auth-error {
          background: #fee;
          color: #c33;
          padding: 0.75rem 1rem;
          border-radius: 6px;
          font-size: 0.875rem;
          border: 1px solid #fcc;
        }

        .form-group {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .form-label {
          font-weight: 500;
          color: #333;
          font-size: 0.875rem;
        }

        .form-input {
          padding: 0.75rem 1rem;
          border: 2px solid #e1e5e9;
          border-radius: 6px;
          font-size: 1rem;
          transition: all 0.2s ease;
          outline: none;
        }

        .form-input:focus {
          border-color: #007bff;
          box-shadow: 0 0 0 3px rgba(0, 123, 255, 0.1);
        }

        .form-input:disabled {
          background-color: #f8f9fa;
          opacity: 0.6;
          cursor: not-allowed;
        }

        .auth-button {
          padding: 0.875rem 1.5rem;
          border: none;
          border-radius: 6px;
          font-size: 1rem;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s ease;
          outline: none;
        }

        .auth-button.primary {
          background: #007bff;
          color: white;
        }

        .auth-button.primary:hover:not(:disabled) {
          background: #0056b3;
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(0, 123, 255, 0.3);
        }

        .auth-button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
          transform: none;
        }

        .form-footer {
          text-align: center;
        }

        .link-button {
          background: none;
          border: none;
          color: #007bff;
          cursor: pointer;
          font-size: 0.875rem;
          text-decoration: underline;
          padding: 0;
          font-weight: 500;
        }

        .link-button:hover {
          color: #0056b3;
        }
      `}</style>
    </form>
  );
};

export default AuthPage;