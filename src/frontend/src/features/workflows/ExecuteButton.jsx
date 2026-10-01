import React, { useState } from 'react';
import { workflowsApi } from '../../services/api/workflows.js';

export default function ExecuteButton({ workflowId, version, onExecuted, onStale, disabled }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const handleClick = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await workflowsApi.execute(workflowId, { expectedVersion: version });
      onExecuted?.(result);
    } catch (err) {
      if (err?.isPreconditionFailed) {
        // Someone (or the engine) changed the workflow after this view loaded.
        setError('This workflow changed since you loaded it. It has been refreshed — check its status and try again.');
        onStale?.(err.currentVersion);
        return;
      }
      setError(err.message || 'Failed to execute');
    } finally {
      setBusy(false);
    }
  };

  return (
    <span>
      <button
        type="button"
        onClick={handleClick}
        disabled={busy || disabled}
        data-testid="execute-button"
      >
        {busy ? 'Executing...' : 'Execute'}
      </button>
      {error && (
        <span className="auth-error" role="alert" style={{ marginLeft: '0.5rem' }}>
          {error}
        </span>
      )}
    </span>
  );
}
