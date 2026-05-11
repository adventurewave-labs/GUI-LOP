import React, { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { workflowsApi } from '../../services/api/workflows.js';
import ExecuteButton from './ExecuteButton.jsx';
import CancelButton from './CancelButton.jsx';
import { useWorkflowEvents } from './useWorkflowEvents.js';

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

export default function WorkflowDetail() {
  const { id } = useParams();
  const [workflow, setWorkflow] = useState(null);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState(null);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const detail = await workflowsApi.getDetail(id);
      setWorkflow(detail);
    } catch (err) {
      setError(err.message || 'Failed to load workflow');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const wsStatus = useWorkflowEvents(
    [
      'workflow.started',
      'workflow.step_started',
      'workflow.human_input_required',
      'workflow.completed',
      'workflow.failed',
      'workflow.cancelled',
    ],
    (envelope) => {
      const targetId =
        envelope?.payload?.workflowId ??
        envelope?.payload?.workflow_id ??
        envelope?.payload?.id;
      if (targetId && targetId !== id) return;
      setBanner({
        type: envelope.type,
        occurredAt: envelope.occurredAt,
        payload: envelope.payload,
      });
      // Re-fetch on terminal/transition events.
      refresh();
    },
  );

  if (loading) return <div data-testid="workflow-loading">Loading workflow...</div>;
  if (error) return <div className="auth-error" role="alert">{error}</div>;
  if (!workflow) return <div>Workflow not found</div>;

  const status = workflow.status ?? workflow.state;

  return (
    <div data-testid="workflow-detail">
      <h2>Workflow {id}</h2>
      <p>
        Status: <strong data-testid="workflow-status">{status}</strong>
      </p>
      <p>
        WebSocket: <span data-testid="ws-status">{wsStatus}</span>
      </p>
      {banner && (
        <div className="status-banner" data-testid="status-banner">
          Latest event: <code>{banner.type}</code> at {banner.occurredAt}
        </div>
      )}
      {!TERMINAL_STATUSES.has(status) && (
        <div className="actions">
          <ExecuteButton workflowId={id} onExecuted={refresh} />
          <CancelButton workflowId={id} onCancelled={refresh} />
        </div>
      )}
      {status === 'waiting_for_human' && (
        <p>
          <Link to="/inbox" data-testid="go-to-inbox">Open inbox to respond</Link>
        </p>
      )}
      <pre data-testid="workflow-json" style={{ background: '#f5f5f5', padding: '1rem' }}>
        {JSON.stringify(workflow, null, 2)}
      </pre>
    </div>
  );
}
