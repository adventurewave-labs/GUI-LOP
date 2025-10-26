/**
 * Lazy-loaded Dashboard page with performance optimizations
 */

import React, { memo, useMemo, useCallback } from 'react';
import { useCache } from '../hooks/useCache';
import { usePerformanceMonitor } from '../utils/performanceMonitor';
import { ProgressiveLoader, DashboardSkeleton } from '../components/common/SkeletonLoader';

const LazyDashboard = memo(({
  user,
  serverStatus,
  wsConnected,
  activeWorkflow,
  workflows,
  onCreateWorkflow,
  onRespondToWorkflow
}) => {
  const { trackInteraction } = usePerformanceMonitor();
  const { getStats: getCacheStats } = useCache();

  // Memoize dashboard stats
  const dashboardStats = useMemo(() => {
    return {
      totalWorkflows: workflows.length,
      activeWorkflows: activeWorkflow ? 1 : 0,
      cacheHitRate: getCacheStats().averageHits,
      lastUpdated: new Date().toLocaleTimeString()
    };
  }, [workflows.length, activeWorkflow, getCacheStats]);

  // Memoize quick actions
  const quickActions = useMemo(() => {
    return workflows.slice(0, 6).map(workflow => ({
      id: workflow.id,
      name: workflow.name,
      description: workflow.description,
      color: workflow.color || '#007bff'
    }));
  }, [workflows]);

  // Handle workflow creation with performance tracking
  const handleCreateWorkflow = useCallback((workflowId) => {
    const startTime = performance.now();
    onCreateWorkflow?.(workflowId);
    trackInteraction('dashboard_create_workflow', startTime);
  }, [onCreateWorkflow, trackInteraction]);

  // Handle workflow response with performance tracking
  const handleRespondToWorkflow = useCallback(() => {
    const startTime = performance.now();
    onRespondToWorkflow?.(activeWorkflow?.workflow_id);
    trackInteraction('dashboard_respond_workflow', startTime);
  }, [onRespondToWorkflow, activeWorkflow, trackInteraction]);

  return (
    <div className="dashboard-page">
      <div className="dashboard-header">
        <h1>GUI-LOP Dashboard</h1>
        <p className="dashboard-subtitle">
          Welcome to the Generative UI & Human-in-the-Loop Orchestration Platform
        </p>
      </div>

      {/* User Info Card */}
      <div className="dashboard-card">
        <h2>User Information</h2>
        <div className="user-details">
          <p><strong>Logged in as:</strong> {user?.username || user?.email}</p>
          <p><strong>Server Status:</strong>
            <span className={`status-indicator ${serverStatus}`}>
              {serverStatus}
            </span>
          </p>
          <p><strong>WebSocket:</strong>
            <span className={`status-indicator ${wsConnected ? 'connected' : 'disconnected'}`}>
              {wsConnected ? 'Connected' : 'Disconnected'}
            </span>
          </p>
        </div>
      </div>

      {/* Dashboard Stats */}
      <div className="dashboard-stats-grid">
        <div className="stat-card">
          <h3>Total Workflows</h3>
          <span className="stat-value">{dashboardStats.totalWorkflows}</span>
        </div>
        <div className="stat-card">
          <h3>Active Workflows</h3>
          <span className="stat-value">{dashboardStats.activeWorkflows}</span>
        </div>
        <div className="stat-card">
          <h3>Cache Hit Rate</h3>
          <span className="stat-value">{dashboardStats.cacheHitRate.toFixed(1)}</span>
        </div>
        <div className="stat-card">
          <h3>Last Updated</h3>
          <span className="stat-value">{dashboardStats.lastUpdated}</span>
        </div>
      </div>

      {/* Active Workflow */}
      {activeWorkflow && (
        <div className="dashboard-card active-workflow-card">
          <h2>Active Workflow</h2>
          <div className="workflow-details">
            <div className="workflow-info">
              <p><strong>ID:</strong> {activeWorkflow.workflow_id}</p>
              <p><strong>Status:</strong>
                <span className={`workflow-status ${activeWorkflow.status}`}>
                  {activeWorkflow.status}
                </span>
              </p>
              <p><strong>Template:</strong> {activeWorkflow.template}</p>
            </div>

            {activeWorkflow.status === 'waiting_for_human' && (
              <div className="workflow-actions">
                <p>The workflow is waiting for your approval.</p>
                <button
                  className="btn btn-success"
                  onClick={handleRespondToWorkflow}
                >
                  Approve & Complete
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div className="dashboard-card">
        <h2>Quick Actions</h2>
        <div className="quick-actions-grid">
          {quickActions.map(workflow => (
            <button
              key={workflow.id}
              className="quick-action-btn"
              onClick={() => handleCreateWorkflow(workflow.id)}
              style={{ borderColor: workflow.color }}
            >
              <span className="action-icon" style={{ backgroundColor: workflow.color }}>
                {workflow.name.charAt(0)}
              </span>
              <span className="action-name">{workflow.name}</span>
            </button>
          ))}
        </div>
      </div>

      <style jsx>{`
        .dashboard-page {
          padding: 0;
          max-width: 1200px;
          margin: 0 auto;
        }

        .dashboard-header {
          margin-bottom: 2rem;
        }

        .dashboard-header h1 {
          font-size: 2rem;
          color: #333;
          margin-bottom: 0.5rem;
        }

        .dashboard-subtitle {
          color: #666;
          font-size: 1rem;
          margin: 0;
        }

        .dashboard-card {
          background: white;
          border-radius: 8px;
          padding: 1.5rem;
          margin-bottom: 1.5rem;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          transition: transform 0.2s ease, box-shadow 0.2s ease;
        }

        .dashboard-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 8px rgba(0,0,0,0.15);
        }

        .dashboard-card h2 {
          margin-bottom: 1rem;
          color: #333;
          font-size: 1.25rem;
        }

        .user-details p {
          margin-bottom: 0.5rem;
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .status-indicator {
          padding: 0.25rem 0.75rem;
          border-radius: 1rem;
          font-size: 0.875rem;
          font-weight: 500;
        }

        .status-indicator.connected {
          background: #d4edda;
          color: #155724;
        }

        .status-indicator.disconnected {
          background: #f8d7da;
          color: #721c24;
        }

        .dashboard-stats-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 1rem;
          margin-bottom: 1.5rem;
        }

        .stat-card {
          background: white;
          border-radius: 8px;
          padding: 1.5rem;
          text-align: center;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }

        .stat-card h3 {
          font-size: 0.875rem;
          color: #666;
          margin-bottom: 0.5rem;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .stat-value {
          font-size: 1.5rem;
          font-weight: bold;
          color: #007bff;
        }

        .active-workflow-card {
          border-left: 4px solid #007bff;
        }

        .workflow-details {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 2rem;
        }

        .workflow-info p {
          margin-bottom: 0.5rem;
        }

        .workflow-status {
          padding: 0.25rem 0.5rem;
          border-radius: 0.25rem;
          font-size: 0.875rem;
          font-weight: 500;
          text-transform: capitalize;
        }

        .workflow-status.waiting_for_human {
          background: #fff3cd;
          color: #856404;
        }

        .workflow-status.executing {
          background: #cce5ff;
          color: #004085;
        }

        .workflow-status.completed {
          background: #d4edda;
          color: #155724;
        }

        .workflow-actions {
          text-align: right;
        }

        .workflow-actions p {
          margin-bottom: 1rem;
          color: #666;
        }

        .quick-actions-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
          gap: 1rem;
        }

        .quick-action-btn {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 1rem;
          border: 2px solid #ddd;
          border-radius: 8px;
          background: white;
          cursor: pointer;
          transition: all 0.2s ease;
          text-align: left;
        }

        .quick-action-btn:hover {
          background: #f8f9fa;
          transform: translateY(-1px);
        }

        .action-icon {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-weight: bold;
          flex-shrink: 0;
        }

        .action-name {
          font-weight: 500;
          color: #333;
        }

        .btn {
          padding: 0.5rem 1rem;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 0.875rem;
          transition: background-color 0.2s ease;
        }

        .btn-success {
          background: #28a745;
          color: white;
        }

        .btn-success:hover {
          background: #1e7e34;
        }

        @media (max-width: 768px) {
          .dashboard-stats-grid {
            grid-template-columns: repeat(2, 1fr);
          }

          .workflow-details {
            flex-direction: column;
            gap: 1rem;
          }

          .workflow-actions {
            text-align: left;
          }

          .quick-actions-grid {
            grid-template-columns: repeat(2, 1fr);
          }
        }
      `}</style>
    </div>
  );
});

LazyDashboard.displayName = 'LazyDashboard';

export default LazyDashboard;