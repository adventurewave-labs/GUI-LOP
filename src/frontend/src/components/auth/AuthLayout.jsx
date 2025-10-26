import React from 'react';
import { Link } from 'react-router-dom';

const AuthLayout = ({ children, title, subtitle }) => {
  return (
    <div className="auth-layout">
      <div className="auth-container">
        {/* Header */}
        <div className="auth-brand">
          <Link to="/" className="brand-link">
            <h1>GUI-LOP</h1>
            <p>Generative UI Platform</p>
          </Link>
        </div>

        {/* Auth Content */}
        <div className="auth-content">
          <div className="auth-card">
            {(title || subtitle) && (
              <div className="auth-header">
                {title && <h2>{title}</h2>}
                {subtitle && <p>{subtitle}</p>}
              </div>
            )}
            {children}
          </div>
        </div>

        {/* Footer */}
        <div className="auth-footer">
          <p>&copy; 2024 GUI-LOP. All rights reserved.</p>
          <div className="footer-links">
            <Link to="/terms">Terms</Link>
            <Link to="/privacy">Privacy</Link>
            <Link to="/support">Support</Link>
          </div>
        </div>
      </div>

      <style jsx>{`
        .auth-layout {
          min-height: 100vh;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 2rem 1rem;
        }

        .auth-container {
          width: 100%;
          max-width: 1200px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2rem;
        }

        .auth-brand {
          text-align: center;
        }

        .brand-link {
          text-decoration: none;
          color: white;
        }

        .brand-link h1 {
          font-size: 2.5rem;
          font-weight: 700;
          margin: 0 0 0.5rem 0;
          text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
        }

        .brand-link p {
          font-size: 1.125rem;
          margin: 0;
          opacity: 0.9;
        }

        .auth-content {
          width: 100%;
          max-width: 400px;
        }

        .auth-card {
          background: white;
          border-radius: 12px;
          padding: 2rem;
          box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
        }

        .auth-header {
          text-align: center;
          margin-bottom: 2rem;
        }

        .auth-header h2 {
          color: #1f2937;
          font-size: 1.75rem;
          font-weight: 600;
          margin: 0 0 0.5rem 0;
        }

        .auth-header p {
          color: #6b7280;
          font-size: 1rem;
          margin: 0;
        }

        .auth-footer {
          text-align: center;
          color: white;
          opacity: 0.8;
        }

        .auth-footer p {
          font-size: 0.875rem;
          margin: 0 0 1rem 0;
        }

        .footer-links {
          display: flex;
          justify-content: center;
          gap: 1.5rem;
        }

        .footer-links a {
          color: white;
          text-decoration: none;
          font-size: 0.875rem;
          opacity: 0.8;
          transition: opacity 0.2s ease;
        }

        .footer-links a:hover {
          opacity: 1;
        }

        @media (max-width: 768px) {
          .auth-layout {
            padding: 1rem;
          }

          .brand-link h1 {
            font-size: 2rem;
          }

          .brand-link p {
            font-size: 1rem;
          }

          .auth-card {
            padding: 1.5rem;
          }

          .auth-header h2 {
            font-size: 1.5rem;
          }

          .footer-links {
            flex-direction: column;
            gap: 0.75rem;
          }
        }

        @media (max-width: 480px) {
          .auth-content {
            max-width: 100%;
          }

          .auth-card {
            padding: 1rem;
          }

          .brand-link h1 {
            font-size: 1.75rem;
          }
        }
      `}</style>
    </div>
  );
};

export default AuthLayout;