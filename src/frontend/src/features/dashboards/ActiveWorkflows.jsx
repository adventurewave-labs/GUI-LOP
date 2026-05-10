import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { dashboardsApi } from '../../services/api/analytics.js';
import { useWorkflowEvents } from '../workflows/useWorkflowEvents.js';

export default function ActiveWorkflows() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = async () => {
    try {
      const result = await dashboardsApi.activeWorkflows();
      setData(result);
    } catch (err) {
      setError(err.message || 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  useWorkflowEvents(
    ['workflow.created', 'workflow.completed', 'workflow.failed', 'workflow.cancelled'],
    () => refresh(),
  );

  if (loading) return <div>Loading active workflows...</div>;
  if (error) return <div className="auth-error" role="alert">{error}</div>;

  const items = (data && (data.items || data.workflows)) || [];

  return (
    <div data-testid="active-workflows">
      <h2>Active workflows</h2>
      {items.length === 0 ? (
        <p>No active workflows.</p>
      ) : (
        <ul>
          {items.map((wf) => {
            const id = wf.workflowId ?? wf.workflow_id ?? wf.id;
            return (
              <li key={id}>
                <Link to={`/workflows/${id}`}>{id}</Link> — {wf.status}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
