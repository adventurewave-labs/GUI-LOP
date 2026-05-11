import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { inboxApi } from '../../services/api/inbox.js';
import { useWorkflowEvents } from '../workflows/useWorkflowEvents.js';

export default function PendingStepsList() {
  const [steps, setSteps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = async () => {
    try {
      const list = await inboxApi.listPending();
      setSteps(Array.isArray(list) ? list : []);
    } catch (err) {
      setError(err.message || 'Failed to load inbox');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  useWorkflowEvents(
    ['workflow.human_input_required', 'human_response.recorded', 'workflow.completed'],
    () => refresh(),
  );

  if (loading) return <div data-testid="inbox-loading">Loading inbox...</div>;
  if (error) return <div className="auth-error" role="alert">{error}</div>;

  return (
    <div data-testid="inbox-list">
      <h2>Pending steps</h2>
      {steps.length === 0 ? (
        <p data-testid="inbox-empty">Nothing waiting on you.</p>
      ) : (
        <ul>
          {steps.map((step) => {
            const wfId = step.workflowId ?? step.workflow_id;
            const stId = step.stepId ?? step.step_id ?? step.id;
            return (
              <li key={`${wfId}:${stId}`} data-testid={`inbox-step-${stId}`}>
                <Link to={`/inbox/${encodeURIComponent(wfId)}/${encodeURIComponent(stId)}`}>
                  Workflow {wfId} — step {stId}
                </Link>
                {step.title && <span> — {step.title}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
