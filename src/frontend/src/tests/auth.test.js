import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from '../contexts/AuthContext';
import LoginForm from '../components/auth/LoginForm';
import RegisterForm from '../components/auth/RegisterForm';
import ProtectedRoute from '../components/auth/ProtectedRoute';

// Mock the API services
jest.mock('../services/api', () => ({
  authAPI: {
    login: jest.fn(),
    register: jest.fn(),
    refreshToken: jest.fn(),
    getCurrentUser: jest.fn(),
    logout: jest.fn(),
  },
  tokenStorage: {
    getTokens: jest.fn(),
    setTokens: jest.fn(),
    clearTokens: jest.fn(),
    getAccessToken: jest.fn(),
  },
}));

// Test wrapper component
const TestWrapper = ({ children }) => (
  <BrowserRouter>
    <AuthProvider>
      {children}
    </AuthProvider>
  </BrowserRouter>
);

describe('Authentication Components', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
  });

  describe('LoginForm', () => {
    it('renders login form with all required fields', () => {
      render(
        <TestWrapper>
          <LoginForm />
        </TestWrapper>
      );

      expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
    });

    it('shows validation errors for empty fields', async () => {
      render(
        <TestWrapper>
          <LoginForm />
        </TestWrapper>
      );

      const submitButton = screen.getByRole('button', { name: /sign in/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText(/email is required/i)).toBeInTheDocument();
        expect(screen.getByText(/password is required/i)).toBeInTheDocument();
      });
    });

    it('shows validation error for invalid email', async () => {
      render(
        <TestWrapper>
          <LoginForm />
        </TestWrapper>
      );

      const emailInput = screen.getByLabelText(/email address/i);
      fireEvent.change(emailInput, { target: { value: 'invalid-email' } });
      fireEvent.blur(emailInput);

      await waitFor(() => {
        expect(screen.getByText(/please enter a valid email address/i)).toBeInTheDocument();
      });
    });

    it('toggles password visibility', () => {
      render(
        <TestWrapper>
          <LoginForm />
        </TestWrapper>
      );

      const passwordInput = screen.getByLabelText(/password/i);
      const toggleButton = screen.getByRole('button', { 'aria-label': /show password/i });

      expect(passwordInput.type).toBe('password');

      fireEvent.click(toggleButton);
      expect(passwordInput.type).toBe('text');

      fireEvent.click(toggleButton);
      expect(passwordInput.type).toBe('password');
    });
  });

  describe('RegisterForm', () => {
    it('renders registration form with all required fields', () => {
      render(
        <TestWrapper>
          <RegisterForm />
        </TestWrapper>
      );

      expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/^password/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /create account/i })).toBeInTheDocument();
    });

    it('shows password strength indicator', async () => {
      render(
        <TestWrapper>
          <RegisterForm />
        </TestWrapper>
      );

      const passwordInput = screen.getByLabelText(/^password/i);

      fireEvent.change(passwordInput, { target: { value: 'weak' } });

      await waitFor(() => {
        expect(screen.getByText(/weak/i)).toBeInTheDocument();
      });
    });

    it('validates password confirmation', async () => {
      render(
        <TestWrapper>
          <RegisterForm />
        </TestWrapper>
      );

      const passwordInput = screen.getByLabelText(/^password/i);
      const confirmPasswordInput = screen.getByLabelText(/confirm password/i);

      fireEvent.change(passwordInput, { target: { value: 'ValidPassword123!' } });
      fireEvent.change(confirmPasswordInput, { target: { value: 'DifferentPassword123!' } });
      fireEvent.blur(confirmPasswordInput);

      await waitFor(() => {
        expect(screen.getByText(/passwords must match/i)).toBeInTheDocument();
      });
    });

    it('requires terms agreement', async () => {
      render(
        <TestWrapper>
          <RegisterForm />
        </TestWrapper>
      );

      const submitButton = screen.getByRole('button', { name: /create account/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText(/you must agree to the terms/i)).toBeInTheDocument();
      });
    });
  });

  describe('ProtectedRoute', () => {
    it('shows loading spinner initially', () => {
      render(
        <TestWrapper>
          <ProtectedRoute>
            <div>Protected Content</div>
          </ProtectedRoute>
        </TestWrapper>
      );

      expect(screen.getByText(/loading/i)).toBeInTheDocument();
    });

    it('requires authentication for protected content', async () => {
      render(
        <TestWrapper>
          <ProtectedRoute>
            <div>Protected Content</div>
          </ProtectedRoute>
        </TestWrapper>
      );

      // Wait for auth check to complete
      await waitFor(() => {
        // Should redirect to login or show access denied
        expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
      });
    });
  });
});

describe('Authentication Flow Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
  });

  it('handles successful login flow', async () => {
    const mockLogin = require('../services/api').authAPI.login;
    mockLogin.mockResolvedValue({
      success: true,
      data: {
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
        user: { id: 1, username: 'testuser', email: 'test@example.com' }
      }
    });

    render(
      <TestWrapper>
        <LoginForm />
      </TestWrapper>
    );

    const emailInput = screen.getByLabelText(/email address/i);
    const passwordInput = screen.getByLabelText(/password/i);
    const submitButton = screen.getByRole('button', { name: /sign in/i });

    fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
    fireEvent.change(passwordInput, { target: { value: 'password123' } });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'password123'
      });
    });
  });

  it('handles login failure with error message', async () => {
    const mockLogin = require('../services/api').authAPI.login;
    mockLogin.mockResolvedValue({
      success: false,
      message: 'Invalid credentials'
    });

    render(
      <TestWrapper>
        <LoginForm />
      </TestWrapper>
    );

    const emailInput = screen.getByLabelText(/email address/i);
    const passwordInput = screen.getByLabelText(/password/i);
    const submitButton = screen.getByRole('button', { name: /sign in/i });

    fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
    fireEvent.change(passwordInput, { target: { value: 'wrongpassword' } });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/invalid credentials/i)).toBeInTheDocument();
    });
  });
});

describe('Token Storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('stores and retrieves tokens correctly', () => {
    const { tokenStorage } = require('../services/api');

    tokenStorage.setTokens('access-token', 'refresh-token');

    expect(tokenStorage.getAccessToken()).toBe('access-token');
    expect(tokenStorage.getRefreshToken()).toBe('refresh-token');
    expect(tokenStorage.getTokens()).toEqual({
      accessToken: 'access-token',
      refreshToken: 'refresh-token'
    });
  });

  it('clears tokens correctly', () => {
    const { tokenStorage } = require('../services/api');

    tokenStorage.setTokens('access-token', 'refresh-token');
    tokenStorage.clearTokens();

    expect(tokenStorage.getAccessToken()).toBeNull();
    expect(tokenStorage.getRefreshToken()).toBeNull();
    expect(tokenStorage.getTokens()).toEqual({
      accessToken: null,
      refreshToken: null
    });
  });

  it('validates JWT token expiry', () => {
    const { tokenStorage } = require('../services/api');

    // Create a valid token (expires in 1 hour)
    const futureTime = Math.floor(Date.now() / 1000) + 3600;
    const validToken = btoa(JSON.stringify({ exp: futureTime }));

    tokenStorage.setAccessToken(validToken);
    expect(tokenStorage.isAccessTokenValid()).toBe(true);

    // Create an expired token (expired 1 hour ago)
    const pastTime = Math.floor(Date.now() / 1000) - 3600;
    const expiredToken = btoa(JSON.stringify({ exp: pastTime }));

    tokenStorage.setAccessToken(expiredToken);
    expect(tokenStorage.isAccessTokenValid()).toBe(false);
  });
});