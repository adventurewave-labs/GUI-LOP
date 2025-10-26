/**
 * Lazy-loaded Workflows page with virtual scrolling and performance optimizations
 */

import React, { memo, useMemo, useCallback, useState } from 'react';
import { VirtualWorkflowList } from '../components/performance/VirtualList';
import { useCache } from '../hooks/useCache';
import { usePerformanceMonitor } from '../utils/performanceMonitor';
import { ProgressiveLoader, WorkflowCardSkeleton } from '../components/common/SkeletonLoader';

const LazyWorkflows = memo(({
  workflows,
  activeWorkflow,
  onCreateWorkflow,
  onRespondToWorkflow,
  loading = false
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('name');
  const [filterStatus, setFilterStatus] = useState('all');

  const { trackInteraction } = usePerformanceMonitor();
  const { getWorkflows, cacheWorkflow } = useCache();

  // Filter and sort workflows
  const filteredWorkflows = useMemo(() => {
    let filtered = workflows.filter(workflow => {
      const matchesSearch = workflow.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           workflow.description.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStatus = filterStatus === 'all' || workflow.status === filterStatus;
      return matchesSearch && matchesStatus;
    });

    // Sort workflows
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'created':
          return new Date(b.created) - new Date(a.created);
        case 'executions':
          return (b.executionCount || 0) - (a.executionCount || 0);
        default:
          return 0;
      }
    });

    return filtered;
  }, [workflows, searchTerm, sortBy, filterStatus]);

  // Workflow statistics
  const workflowStats = useMemo(() => {
    const total = workflows.length;
    const executing = workflows.filter(w => w.status === 'executing').length;
    const completed = workflows.filter(w => w.status === 'completed').length;
    const pending = workflows.filter(w => w.status === 'pending').length;

    return { total, executing, completed, pending };
  }, [workflows]);

  // Handle workflow selection with performance tracking
  const handleWorkflowSelect = useCallback((workflow) => {
    const startTime = performance.now();
    cacheWorkflow(workflow);
    trackInteraction('workflow_select', startTime);
  }, [cacheWorkflow, trackInteraction]);

  // Handle workflow execution with performance tracking
  const handleWorkflowExecute = useCallback((workflow) => {
    const startTime = performance.now();
    onCreateWorkflow?.(workflow.id);
    trackInteraction('workflow_execute', startTime);
  }, [onCreateWorkflow, trackInteraction]);

  // Handle workflow response with performance tracking
  const handleRespondToWorkflow = useCallback(() => {
    const startTime = performance.now();
    onRespondToWorkflow?.(activeWorkflow?.workflow_id);
    trackInteraction('workflow_respond', startTime);
  }, [onRespondToWorkflow, activeWorkflow, trackInteraction]);

  // Clear filters
  const clearFilters = useCallback(() => {
    setSearchTerm('');
    setFilterStatus('all');
    setSortBy('name');
  }, []);

  return (
    <div className="workflows-page">
      <div className="workflows-header">
        <h1>Workflows</h1>
        <p>Manage and execute your automated workflows</p>
      </div>

      {/* Workflow Statistics */}
      <div className="workflow-stats">
        <div className="stat-item">
          <span className="stat-number">{workflowStats.total}</span>
          <span className="stat-label">Total</span>
        </div>
        <div className="stat-item">
          <span className="stat-number">{workflowStats.executing}</span>
          <span className="stat-label">Executing</span>
        </div>
        <div className="stat-item">
          <span className="stat-number">{workflowStats.completed}</span>
          <span className="stat-label">Completed</span>
        </div>
        <div className="stat-item">
          <span className="stat-number">{workflowStats.pending}</span>
          <span className="stat-label">Pending</span>
        </div>
      </div>

      {/* Filters and Search */}
      <div className="workflows-filters">
        <div className="filter-group">
          <input
            type="text"
            placeholder="Search workflows..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-input"
          />
        </div>

        <div className="filter-group">
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="filter-select"
          >
            <option value="all">All Status</option>
            <option value="pending">Pending</option>
            <option value="executing">Executing</option>
            <option value="completed">Completed</option>
          </select>
        </div>

        <div className="filter-group">
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="filter-select"
          >
            <option value="name">Sort by Name</option>
            <option value="created">Sort by Created</option>
            <option value="executions">Sort by Executions</option>
          </select>
        </div>

        {(searchTerm || filterStatus !== 'all' || sortBy !== 'name') && (
          <button
            className="clear-filters-btn"
            onClick={clearFilters}
          >
            Clear Filters
          </button>
        )}
      </div>

      {/* Active Workflow */}
      {activeWorkflow && (
        <div className="active-workflow-banner">
          <div className="banner-content">
            <div className="banner-info">
              <h3>Active Workflow: {activeWorkflow.template}</h3>
              <p>ID: {activeWorkflow.workflow_id} | Status: {activeWorkflow.status}</p>
            </div>
            {activeWorkflow.status === 'waiting_for_human' && (
              <button
                className="btn btn-success"
                onClick={handleRespondToWorkflow}
              >
                Approve & Continue
              </button>
            )}
          </div>
        </div>
      )}

      {/* Workflows List */}
      <div className="workflows-content">
        <ProgressiveLoader
          loading={loading}
          delay={300}
          skeleton={<WorkflowCardSkeleton items={5} />}
        >
          {filteredWorkflows.length === 0 ? (
            <div className="empty-state">
              <h3>No workflows found</h3>
              <p>
                {searchTerm || filterStatus !== 'all'
                  ? 'Try adjusting your filters or search terms.'
                  : 'No workflows are available at the moment.'}
              </p>
            </div>
          ) : (
            <VirtualWorkflowList
              workflows={filteredWorkflows}
              onWorkflowSelect={handleWorkflowSelect}
              onWorkflowExecute={handleWorkflowExecute}
              selectedWorkflowId={activeWorkflow?.workflow_id}
              className="workflows-virtual-list"
            />
          )}
        </ProgressiveLoader>
      </div>

      <style jsx>{`
        .workflows-page {
          padding: 0;
          max-width: 1200px;
          margin: 0 auto;
        }

        .workflows-header {
          margin-bottom: 2rem;
        }

        .workflows-header h1 {
          font-size: 2rem;
          color: #333;
          margin-bottom: 0.5rem;
        }

        .workflows-header p {
          color: #666;
          font-size: 1rem;
          margin: 0;
        }

        .workflow-stats {
          display: flex;
          gap: 1rem;
          margin-bottom: 2rem;
          flex-wrap: wrap;
        }

        .stat-item {
          background: white;
          border-radius: 8px;
          padding: 1rem 1.5rem;
          text-align: center;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          min-width: 120px;
        }

        .stat-number {
          display: block;
          font-size: 1.5rem;
          font-weight: bold;
          color: #007bff;
        }

        .stat-label {
          font-size: 0.875rem;
          color: #666;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .workflows-filters {
          display: flex;
          gap: 1rem;
          margin-bottom: 2rem;
          flex-wrap: wrap;
          align-items: center;
        }

        .filter-group {
          flex: 1;
          min-width: 200px;
        }

        .search-input,
        .filter-select {
          width: 100%;
          padding: 0.75rem;
          border: 1px solid #ddd;
          border-radius: 4px;
          font-size: 0.875rem;
          background: white;
        }

        .search-input:focus,
        .filter-select:focus {
          outline: none;
          border-color: #007bff;
          box-shadow: 0 0 0 2px rgba(0, 123, 255, 0.25);
        }

        .clear-filters-btn {
          padding: 0.75rem 1rem;
          border: 1px solid #dc3545;
          background: white;
          color: #dc3545;
          border-radius: 4px;
          cursor: pointer;
          font-size: 0.875rem;
          transition: all 0.2s ease;
        }

        .clear-filters-btn:hover {
          background: #dc3545;
          color: white;
        }

        .active-workflow-banner {
          background: linear-gradient(135deg, #007bff, #0056b3);
          color: white;
          border-radius: 8px;
          padding: 1.5rem;
          margin-bottom: 2rem;
        }

        .banner-content {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 2rem;
        }

        .banner-info h3 {
          margin-bottom: 0.5rem;
          font-size: 1.25rem;
        }

        .banner-info p {
          margin: 0;
          opacity: 0.9;
        }

        .btn {
          padding: 0.5rem 1rem;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 0.875rem;
          transition: all 0.2s ease;
          white-space: nowrap;
        }

        .btn-success {
          background: #28a745;
          color: white;
        }

        .btn-success:hover {
          background: #1e7e34;
          transform: translateY(-1px);
        }

        .workflows-content {
          background: white;
          border-radius: 8px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          overflow: hidden;
        }

        .workflows-virtual-list {
          height: 600px;
        }

        .empty-state {
          text-align: center;
          padding: 3rem;
          color: #666;
        }

        .empty-state h3 {
          margin-bottom: 1rem;
          color: #333;
        }

        .workflow-virtual-item {
          border-bottom: 1px solid #eee;
          transition: background-color 0.2s ease;
        }

        .workflow-virtual-item:hover {
          background-color: #f8f9fa;
        }

        .workflow-virtual-item.selected {
          background-color: #e7f3ff;
          border-left: 4px solid #007bff;
        }

        @media (max-width: 768px) {
          .workflow-stats {
            justify-content: space-between;
          }

          .stat-item {
            min-width: calc(50% - 0.5rem);
          }

          .workflows-filters {
            flex-direction: column;
            align-items: stretch;
          }

          .filter-group {
            min-width: auto;
          }

          .banner-content {
            flex-direction: column;
            align-items: flex-start;
            gap: 1rem;
          }

          .workflows-virtual-list {
            height: 500px;
          }
        }
      `}</style>
    </div>
  );
});

LazyWorkflows.displayName = 'LazyWorkflows';

export default LazyWorkflows;