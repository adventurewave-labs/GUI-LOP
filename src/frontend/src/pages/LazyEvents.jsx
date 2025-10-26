/**
 * Lazy-loaded Events page with performance optimizations
 */

import React, { memo, useMemo, useCallback, useState, useEffect, useRef } from 'react';
import { useCache } from '../hooks/useCache';
import { usePerformanceMonitor } from '../utils/performanceMonitor';
import { ProgressiveLoader } from '../components/common/SkeletonLoader';

const LazyEvents = memo(({
  logs = [],
  onClearLogs,
  maxLogs = 1000
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterLevel, setFilterLevel] = useState('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const [expandedLogs, setExpandedLogs] = useState(new Set());

  const logsContainerRef = useRef(null);
  const { trackInteraction } = usePerformanceMonitor();
  const { getStats } = useCache();

  // Filter logs based on search and level
  const filteredLogs = useMemo(() => {
    return logs
      .slice(-maxLogs) // Take only the last maxLogs
      .filter(log => {
        const matchesSearch = searchTerm === '' ||
                             log.message.toLowerCase().includes(searchTerm.toLowerCase()) ||
                             log.timestamp.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesLevel = filterLevel === 'all' || log.level === filterLevel;
        return matchesSearch && matchesLevel;
      });
  }, [logs, searchTerm, filterLevel, maxLogs]);

  // Log statistics
  const logStats = useMemo(() => {
    const stats = {
      total: logs.length,
      info: logs.filter(log => log.level === 'info').length,
      warning: logs.filter(log => log.level === 'warning').length,
      error: logs.filter(log => log.level === 'error').length,
      debug: logs.filter(log => log.level === 'debug').length
    };
    return stats;
  }, [logs]);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll && logsContainerRef.current) {
      const container = logsContainerRef.current;
      container.scrollTop = container.scrollHeight;
    }
  }, [filteredLogs, autoScroll]);

  // Handle search with performance tracking
  const handleSearch = useCallback((value) => {
    const startTime = performance.now();
    setSearchTerm(value);
    trackInteraction('event_search', startTime);
  }, [trackInteraction]);

  // Handle log level filter with performance tracking
  const handleLevelFilter = useCallback((level) => {
    const startTime = performance.now();
    setFilterLevel(level);
    trackInteraction('event_filter_level', startTime);
  }, [trackInteraction]);

  // Handle clear logs with performance tracking
  const handleClearLogs = useCallback(() => {
    const startTime = performance.now();
    onClearLogs?.();
    trackInteraction('event_clear_logs', startTime);
  }, [onClearLogs, trackInteraction]);

  // Toggle log expansion
  const toggleLogExpansion = useCallback((index) => {
    setExpandedLogs(prev => {
      const newSet = new Set(prev);
      if (newSet.has(index)) {
        newSet.delete(index);
      } else {
        newSet.add(index);
      }
      return newSet;
    });
  }, []);

  // Get log level color
  const getLogLevelColor = useCallback((level) => {
    switch (level) {
      case 'error': return '#dc3545';
      case 'warning': return '#ffc107';
      case 'info': return '#007bff';
      case 'debug': return '#6c757d';
      default: return '#333';
    }
  }, []);

  // Format log entry
  const formatLogEntry = useCallback((log, index) => {
    const isExpanded = expandedLogs.has(index);
    const hasDetails = log.details || log.stack || log.metadata;

    return (
      <div
        key={index}
        className={`log-entry ${log.level}`}
        onClick={() => hasDetails && toggleLogExpansion(index)}
      >
        <div className="log-header">
          <span className="log-timestamp">{log.timestamp}</span>
          <span
            className="log-level"
            style={{ color: getLogLevelColor(log.level) }}
          >
            {log.level?.toUpperCase()}
          </span>
          <span className="log-message">{log.message}</span>
          {hasDetails && (
            <span className="log-expand-toggle">
              {isExpanded ? '▼' : '▶'}
            </span>
          )}
        </div>

        {isExpanded && hasDetails && (
          <div className="log-details">
            {log.details && (
              <div className="log-detail">
                <strong>Details:</strong>
                <pre>{JSON.stringify(log.details, null, 2)}</pre>
              </div>
            )}
            {log.stack && (
              <div className="log-detail">
                <strong>Stack Trace:</strong>
                <pre>{log.stack}</pre>
              </div>
            )}
            {log.metadata && (
              <div className="log-detail">
                <strong>Metadata:</strong>
                <pre>{JSON.stringify(log.metadata, null, 2)}</pre>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }, [expandedLogs, toggleLogExpansion, getLogLevelColor]);

  // Export logs
  const exportLogs = useCallback(() => {
    const startTime = performance.now();
    const logsData = {
      timestamp: new Date().toISOString(),
      totalLogs: filteredLogs.length,
      logs: filteredLogs,
      stats: logStats
    };

    const blob = new Blob([JSON.stringify(logsData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gui-lop-logs-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    trackInteraction('event_export_logs', startTime);
  }, [filteredLogs, logStats, trackInteraction]);

  return (
    <div className="events-page">
      <div className="events-header">
        <h1>Event Log</h1>
        <p>Real-time events and system logs</p>
      </div>

      {/* Log Statistics */}
      <div className="log-stats-container">
        <div className="log-stats">
          <div className="stat-item">
            <span className="stat-number">{logStats.total}</span>
            <span className="stat-label">Total</span>
          </div>
          <div className="stat-item">
            <span className="stat-number" style={{ color: '#dc3545' }}>{logStats.error}</span>
            <span className="stat-label">Errors</span>
          </div>
          <div className="stat-item">
            <span className="stat-number" style={{ color: '#ffc107' }}>{logStats.warning}</span>
            <span className="stat-label">Warnings</span>
          </div>
          <div className="stat-item">
            <span className="stat-number" style={{ color: '#007bff' }}>{logStats.info}</span>
            <span className="stat-label">Info</span>
          </div>
        </div>

        <div className="log-actions">
          <button
            className="btn btn-secondary"
            onClick={exportLogs}
            disabled={filteredLogs.length === 0}
          >
            Export Logs
          </button>
          <button
            className="btn btn-danger"
            onClick={handleClearLogs}
            disabled={filteredLogs.length === 0}
          >
            Clear Logs
          </button>
        </div>
      </div>

      {/* Controls */}
      <div className="events-controls">
        <div className="control-group">
          <input
            type="text"
            placeholder="Search logs..."
            value={searchTerm}
            onChange={(e) => handleSearch(e.target.value)}
            className="search-input"
          />
        </div>

        <div className="control-group">
          <select
            value={filterLevel}
            onChange={(e) => handleLevelFilter(e.target.value)}
            className="filter-select"
          >
            <option value="all">All Levels</option>
            <option value="error">Errors Only</option>
            <option value="warning">Warnings</option>
            <option value="info">Info</option>
            <option value="debug">Debug</option>
          </select>
        </div>

        <div className="control-group">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
            />
            Auto-scroll
          </label>
        </div>

        <div className="control-group">
          <span className="log-count">
            Showing {filteredLogs.length} of {logs.length} logs
          </span>
        </div>
      </div>

      {/* Logs Container */}
      <div className="events-container">
        <ProgressiveLoader
          loading={false}
          delay={200}
          fallback={
            <div className="loading-logs">
              <div className="loading-spinner"></div>
              <p>Loading events...</p>
            </div>
          }
        >
          {filteredLogs.length === 0 ? (
            <div className="empty-logs">
              <h3>No logs to display</h3>
              <p>
                {searchTerm || filterLevel !== 'all'
                  ? 'Try adjusting your search or filter criteria.'
                  : 'No events have been logged yet.'}
              </p>
            </div>
          ) : (
            <div
              ref={logsContainerRef}
              className="logs-container"
              onScroll={() => {
                const container = logsContainerRef.current;
                const isAtBottom = container.scrollHeight - container.scrollTop === container.clientHeight;
                setAutoScroll(isAtBottom);
              }}
            >
              {filteredLogs.map((log, index) => formatLogEntry(log, logs.length - filteredLogs.length + index))}
            </div>
          )}
        </ProgressiveLoader>
      </div>

      <style jsx>{`
        .events-page {
          padding: 0;
          max-width: 1200px;
          margin: 0 auto;
        }

        .events-header {
          margin-bottom: 2rem;
        }

        .events-header h1 {
          font-size: 2rem;
          color: #333;
          margin-bottom: 0.5rem;
        }

        .events-header p {
          color: #666;
          font-size: 1rem;
          margin: 0;
        }

        .log-stats-container {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 2rem;
          flex-wrap: wrap;
          gap: 1rem;
        }

        .log-stats {
          display: flex;
          gap: 1rem;
          flex-wrap: wrap;
        }

        .stat-item {
          background: white;
          border-radius: 8px;
          padding: 1rem 1.5rem;
          text-align: center;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          min-width: 80px;
        }

        .stat-number {
          display: block;
          font-size: 1.25rem;
          font-weight: bold;
          color: #333;
        }

        .stat-label {
          font-size: 0.75rem;
          color: #666;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .log-actions {
          display: flex;
          gap: 0.5rem;
        }

        .btn {
          padding: 0.5rem 1rem;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 0.875rem;
          transition: all 0.2s ease;
        }

        .btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .btn-secondary {
          background: #6c757d;
          color: white;
        }

        .btn-secondary:hover:not(:disabled) {
          background: #545b62;
        }

        .btn-danger {
          background: #dc3545;
          color: white;
        }

        .btn-danger:hover:not(:disabled) {
          background: #c82333;
        }

        .events-controls {
          display: flex;
          gap: 1rem;
          margin-bottom: 1.5rem;
          flex-wrap: wrap;
          align-items: center;
        }

        .control-group {
          display: flex;
          align-items: center;
        }

        .search-input,
        .filter-select {
          padding: 0.5rem;
          border: 1px solid #ddd;
          border-radius: 4px;
          font-size: 0.875rem;
          background: white;
          min-width: 200px;
        }

        .search-input:focus,
        .filter-select:focus {
          outline: none;
          border-color: #007bff;
          box-shadow: 0 0 0 2px rgba(0, 123, 255, 0.25);
        }

        .checkbox-label {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          cursor: pointer;
          font-size: 0.875rem;
          color: #666;
        }

        .log-count {
          font-size: 0.875rem;
          color: #666;
          font-style: italic;
        }

        .events-container {
          background: #1e1e1e;
          border-radius: 8px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          overflow: hidden;
        }

        .loading-logs {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 3rem;
          color: #999;
        }

        .loading-spinner {
          width: 24px;
          height: 24px;
          border: 2px solid #333;
          border-top: 2px solid #007bff;
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin-bottom: 1rem;
        }

        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        .empty-logs {
          text-align: center;
          padding: 3rem;
          color: #999;
        }

        .empty-logs h3 {
          margin-bottom: 1rem;
          color: #ccc;
        }

        .logs-container {
          height: 500px;
          overflow-y: auto;
          font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
          font-size: 0.875rem;
          line-height: 1.4;
        }

        .log-entry {
          border-bottom: 1px solid #333;
          padding: 0.75rem;
          cursor: pointer;
          transition: background-color 0.2s ease;
        }

        .log-entry:hover {
          background-color: rgba(255, 255, 255, 0.05);
        }

        .log-entry.error {
          border-left: 3px solid #dc3545;
        }

        .log-entry.warning {
          border-left: 3px solid #ffc107;
        }

        .log-entry.info {
          border-left: 3px solid #007bff;
        }

        .log-entry.debug {
          border-left: 3px solid #6c757d;
        }

        .log-header {
          display: flex;
          align-items: center;
          gap: 1rem;
        }

        .log-timestamp {
          color: #999;
          font-size: 0.75rem;
          min-width: 80px;
        }

        .log-level {
          font-weight: bold;
          min-width: 60px;
          text-transform: uppercase;
          font-size: 0.75rem;
        }

        .log-message {
          flex: 1;
          color: #fff;
        }

        .log-expand-toggle {
          color: #999;
          font-size: 0.75rem;
          margin-left: 0.5rem;
        }

        .log-details {
          margin-top: 0.5rem;
          padding-top: 0.5rem;
          border-top: 1px solid #333;
        }

        .log-detail {
          margin-bottom: 0.5rem;
        }

        .log-detail strong {
          color: #ccc;
          display: block;
          margin-bottom: 0.25rem;
        }

        .log-detail pre {
          margin: 0;
          color: #999;
          font-size: 0.75rem;
          white-space: pre-wrap;
          word-break: break-word;
        }

        @media (max-width: 768px) {
          .log-stats-container {
            flex-direction: column;
            align-items: flex-start;
          }

          .events-controls {
            flex-direction: column;
            align-items: stretch;
          }

          .control-group {
            justify-content: space-between;
          }

          .search-input,
          .filter-select {
            min-width: auto;
            flex: 1;
            margin-right: 1rem;
          }

          .log-header {
            flex-wrap: wrap;
            gap: 0.5rem;
          }

          .log-timestamp {
            min-width: auto;
          }

          .logs-container {
            height: 400px;
          }
        }
      `}</style>
    </div>
  );
});

LazyEvents.displayName = 'LazyEvents';

export default LazyEvents;