import React, { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import * as yup from 'yup';
import { useAuth } from '../../contexts/AuthContext';

// Validation schema
const registerSchema = yup.object().shape({
  username: yup
    .string()
    .min(3, 'Username must be at least 3 characters long')
    .max(30, 'Username cannot exceed 30 characters')
    .matches(/^[a-zA-Z0-9_-]+$/, 'Username can only contain letters, numbers, underscores, and hyphens')
    .required('Username is required'),
  email: yup
    .string()
    .email('Please enter a valid email address')
    .required('Email is required'),
  password: yup
    .string()
    .min(8, 'Password must be at least 8 characters long')
    .matches(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/,
      'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'
    )
    .required('Password is required'),
  confirmPassword: yup
    .string()
    .oneOf([yup.ref('password'), null], 'Passwords must match')
    .required('Please confirm your password'),
  agreeToTerms: yup
    .boolean()
    .oneOf([true], 'You must agree to the terms and conditions'),
});

const RegisterForm = ({ onToggleForm, onRegisterSuccess }) => {
  const { register: registerUser, isLoading, error, clearError } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [passwordStrength, setPasswordStrength] = useState(0);

  const {
    register,
    handleSubmit,
    formState: { errors, isValid },
    setError,
    watch,
    trigger,
  } = useForm({
    resolver: yupResolver(registerSchema),
    mode: 'onChange',
  });

  const password = watch('password');

  // Calculate password strength
  useEffect(() => {
    if (!password) {
      setPasswordStrength(0);
      return;
    }

    let strength = 0;

    // Length check
    if (password.length >= 8) strength++;
    if (password.length >= 12) strength++;

    // Character variety checks
    if (/[a-z]/.test(password)) strength++;
    if (/[A-Z]/.test(password)) strength++;
    if (/\d/.test(password)) strength++;
    if (/[@$!%*?&]/.test(password)) strength++;

    setPasswordStrength(Math.min(4, strength));
  }, [password]);

  // Clear any existing errors when component mounts
  useEffect(() => {
    clearError();
  }, [clearError]);

  // Handle form submission
  const onSubmit = async (data) => {
    setIsSubmitting(true);
    clearError();

    try {
      const { confirmPassword, agreeToTerms, ...registrationData } = data;

      const result = await registerUser(registrationData);

      if (result.success) {
        onRegisterSuccess?.(result.user);
      } else {
        // Set form-level error if registration failed
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

  // Get password strength label and color
  const getPasswordStrengthInfo = () => {
    const levels = [
      { label: 'Very Weak', color: '#dc3545' },
      { label: 'Weak', color: '#fd7e14' },
      { label: 'Fair', color: '#ffc107' },
      { label: 'Good', color: '#20c997' },
      { label: 'Strong', color: '#28a745' },
    ];
    return levels[passwordStrength] || levels[0];
  };

  const strengthInfo = getPasswordStrengthInfo();

  return (
    <div className="auth-form">
      <div className="auth-header">
        <h2>Create Account</h2>
        <p>Join GUI-LOP to start building amazing interfaces</p>
      </div>

      {/* Display authentication errors */}
      {(error || errors.root) && (
        <div className="auth-error">
          {error || errors.root?.message}
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="auth-form-body">
        {/* Username Field */}
        <div className="form-group">
          <label htmlFor="username" className="form-label">
            Username
          </label>
          <input
            type="text"
            id="username"
            className={`form-input ${errors.username ? 'error' : ''}`}
            placeholder="Choose a username"
            {...register('username')}
            onFocus={handleInputFocus}
            disabled={isSubmitting}
            autoComplete="username"
          />
          {errors.username && (
            <span className="form-error">{errors.username.message}</span>
          )}
        </div>

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
              placeholder="Create a strong password"
              {...register('password', {
                onChange: () => trigger('confirmPassword'),
              })}
              onFocus={handleInputFocus}
              disabled={isSubmitting}
              autoComplete="new-password"
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

          {/* Password Strength Indicator */}
          {password && (
            <div className="password-strength">
              <div className="strength-bar">
                <div
                  className="strength-fill"
                  style={{
                    width: `${(passwordStrength / 4) * 100}%`,
                    backgroundColor: strengthInfo.color,
                  }}
                />
              </div>
              <span className="strength-label" style={{ color: strengthInfo.color }}>
                {strengthInfo.label}
              </span>
            </div>
          )}

          {errors.password && (
            <span className="form-error">{errors.password.message}</span>
          )}
        </div>

        {/* Confirm Password Field */}
        <div className="form-group">
          <label htmlFor="confirmPassword" className="form-label">
            Confirm Password
          </label>
          <div className="password-input-wrapper">
            <input
              type={showConfirmPassword ? 'text' : 'password'}
              id="confirmPassword"
              className={`form-input ${errors.confirmPassword ? 'error' : ''}`}
              placeholder="Confirm your password"
              {...register('confirmPassword')}
              onFocus={handleInputFocus}
              disabled={isSubmitting}
              autoComplete="new-password"
            />
            <button
              type="button"
              className="password-toggle"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              disabled={isSubmitting}
              aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
            >
              {showConfirmPassword ? '👁️' : '👁️‍🗨️'}
            </button>
          </div>
          {errors.confirmPassword && (
            <span className="form-error">{errors.confirmPassword.message}</span>
          )}
        </div>

        {/* Terms Agreement */}
        <div className="form-group">
          <label className="checkbox-label">
            <input
              type="checkbox"
              className="checkbox-input"
              {...register('agreeToTerms')}
              disabled={isSubmitting}
            />
            <span className="checkbox-text">
              I agree to the{' '}
              <a href="/terms" target="_blank" rel="noopener noreferrer" className="terms-link">
                Terms and Conditions
              </a>{' '}
              and{' '}
              <a href="/privacy" target="_blank" rel="noopener noreferrer" className="terms-link">
                Privacy Policy
              </a>
            </span>
          </label>
          {errors.agreeToTerms && (
            <span className="form-error">{errors.agreeToTerms.message}</span>
          )}
        </div>

        {/* Submit Button */}
        <button
          type="submit"
          className="auth-button primary"
          disabled={!isValid || isSubmitting || isLoading}
        >
          {isSubmitting || isLoading ? 'Creating Account...' : 'Create Account'}
        </button>
      </form>

      {/* Form Footer */}
      <div className="auth-footer">
        <div className="auth-switch">
          Already have an account?{' '}
          <button
            type="button"
            className="link-button"
            onClick={() => onToggleForm?.('login')}
          >
            Sign in
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

        .password-strength {
          margin-top: 0.5rem;
        }

        .strength-bar {
          height: 4px;
          background: #e9ecef;
          border-radius: 2px;
          overflow: hidden;
          margin-bottom: 0.25rem;
        }

        .strength-fill {
          height: 100%;
          transition: all 0.3s ease;
        }

        .strength-label {
          font-size: 0.75rem;
          font-weight: 500;
        }

        .checkbox-label {
          display: flex;
          align-items: flex-start;
          gap: 0.5rem;
          cursor: pointer;
          font-size: 0.875rem;
        }

        .checkbox-input {
          margin-top: 0.125rem;
        }

        .checkbox-text {
          flex: 1;
          color: #666;
          line-height: 1.4;
        }

        .terms-link {
          color: #007bff;
          text-decoration: none;
        }

        .terms-link:hover {
          text-decoration: underline;
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
          background: #28a745;
          color: white;
        }

        .auth-button.primary:hover:not(:disabled) {
          background: #218838;
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(40, 167, 69, 0.3);
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

          .checkbox-text {
            font-size: 0.8rem;
          }
        }
      `}</style>
    </div>
  );
};

export default RegisterForm;