import React, { useEffect, useState } from 'react';
import { analyticsApi } from '../../services/api/analytics.js';

export default function WorkflowAnalytics() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const result = await analyticsApi.workflows();
        if (mounted) setStats(result);
      } catch (err) {
        if (mounted) setError(err.message || 'Failed to load analytics');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  if (loading) return <div>Loading analytics...</div>;
  if (error) return <div className="auth-error" role="alert">{error}</div>;

  return (
    <div data-testid="workflow-analytics">
      <h2>Workflow analytics</h2>
      <pre style={{ background: '#f5f5f5', padding: '1rem' }}>
        {JSON.stringify(stats, null, 2)}
      </pre>
    </div>
  );
}
