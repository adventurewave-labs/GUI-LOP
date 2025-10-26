import React, { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import * as yup from 'yup';
import { useAuth } from '../../contexts/AuthContext';

// Validation schema
const loginSchema = yup.object().shape({
  email: yup
    .string()
    .email('Please enter a valid email address')
    .required('Email is required'),
  password: yup
    .string()
    .min(6, 'Password must be at least 6 characters long')
    .required('Password is required'),
});

const LoginForm = ({ onToggleForm, onLoginSuccess }) => {
  const { login, isLoading, error, clearError } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isValid },
    setError,
  } = useForm({
    resolver: yupResolver(loginSchema),
    mode: 'onChange',
  });

  // Clear any existing errors when component mounts
  useEffect(() => {
    clearError();
  }, [clearError]);

  // Handle form submission
  const onSubmit = async (data) => {
    setIsSubmitting(true);
    clearError();

    try {
      const result = await login(data);

      if (result.success) {
        onLoginSuccess?.(result.user);
      } else {
        // Set form-level error if login failed
        setError('root', { message: result.error });
      }
    } catch (error) {
      setError('root', { message: 'An unexpected error occurred. Please try again.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle input focus
  const handleInputFocus = () => {
    clearError();
    setError('root');
  };

  return (
    <div className="auth-form">
      <div className="auth-header">
        <h2>Welcome Back</h2>
        <p>Sign in to your account to continue</p>
      </div>

      {/* Display authentication errors */}
      {(error || errors.root) && (
        <div className="auth-error">
          {error || errors.root?.message}
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="auth-form-body">
        {/* Email Field */}
        <div className="form-group">
          <label htmlFor="email" className="form-label">
            Email Address
          </label>
          <input
            type="email"
            id="email"
            className={`form-input ${errors.email ? 'error' : ''}`}
            placeholder="Enter your email"
            {...register('email')}
            onFocus={handleInputFocus}
            disabled={isSubmitting}
            autoComplete="email"
          />
          {errors.email && (
            <span className="form-error">{errors.email.message}</span>
          )}
        </div>

        {/* Password Field */}
        <div className="form-group">
          <label htmlFor="password" className="form-label">
            Password
          </label>
          <div className="password-input-wrapper">
            <input
              type={showPassword ? 'text' : 'password'}
              id="password"
              className={`form-input ${errors.password ? 'error' : ''}`}
              placeholder="Enter your password"
              {...register('password')}
              onFocus={handleInputFocus}
              disabled={isSubmitting}
              autoComplete="current-password"
            />
            <button
              type="button"
              className="password-toggle"
              onClick={() => setShowPassword(!showPassword)}
              disabled={isSubmitting}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? '👁️' : '👁️‍🗨️'}
            </button>
          </div>
          {errors.password && (
            <span className="form-error">{errors.password.message}</span>
          )}
        </div>

        {/* Submit Button */}
        <button
          type="submit"
          className="auth-button primary"
          disabled={!isValid || isSubmitting || isLoading}
        >
          {isSubmitting || isLoading ? 'Signing in...' : 'Sign In'}
        </button>
      </form>

      {/* Form Footer */}
      <div className="auth-footer">
        <div className="auth-links">
          <button
            type="button"
            className="link-button"
            onClick={() => onToggleForm?.('forgot-password')}
          >
            Forgot your password?
          </button>
        </div>
        <div className="auth-switch">
          Don't have an account?{' '}
          <button
            type="button"
            className="link-button"
            onClick={() => onToggleForm?.('register')}
          >
            Sign up
          </button>
        </div>
      </div>

      <style jsx>{`
        .auth-form {
          width: 100%;
          max-width: 400px;
          margin: 0 auto;
        }

        .auth-header {
          text-align: center;
          margin-bottom: 2rem;
        }

        .auth-header h2 {
          color: #333;
          font-size: 1.75rem;
          font-weight: 600;
          margin-bottom: 0.5rem;
        }

        .auth-header p {
          color: #666;
          font-size: 1rem;
        }

        .auth-error {
          background: #fee;
          color: #c33;
          padding: 0.75rem 1rem;
          border-radius: 6px;
          margin-bottom: 1rem;
          font-size: 0.875rem;
          border: 1px solid #fcc;
        }

        .auth-form-body {
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
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

        .form-input.error {
          border-color: #dc3545;
        }

        .form-input.error:focus {
          box-shadow: 0 0 0 3px rgba(220, 53, 69, 0.1);
        }

        .form-input:disabled {
          background-color: #f8f9fa;
          opacity: 0.6;
          cursor: not-allowed;
        }

        .password-input-wrapper {
          position: relative;
          display: flex;
          align-items: center;
        }

        .password-toggle {
          position: absolute;
          right: 0.75rem;
          background: none;
          border: none;
          cursor: pointer;
          padding: 0.25rem;
          font-size: 1.25rem;
          opacity: 0.6;
          transition: opacity 0.2s ease;
        }

        .password-toggle:hover {
          opacity: 1;
        }

        .password-toggle:disabled {
          cursor: not-allowed;
        }

        .form-error {
          color: #dc3545;
          font-size: 0.75rem;
          margin-top: 0.25rem;
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

        .auth-footer {
          margin-top: 1.5rem;
          text-align: center;
        }

        .auth-links {
          margin-bottom: 1rem;
        }

        .auth-switch {
          color: #666;
          font-size: 0.875rem;
        }

        .link-button {
          background: none;
          border: none;
          color: #007bff;
          cursor: pointer;
          font-size: inherit;
          text-decoration: underline;
          padding: 0;
          font-weight: 500;
        }

        .link-button:hover {
          color: #0056b3;
        }

        @media (max-width: 480px) {
          .auth-form {
            padding: 0 1rem;
          }

          .auth-header h2 {
            font-size: 1.5rem;
          }
        }
      `}</style>
    </div>
  );
};

export default LoginForm;