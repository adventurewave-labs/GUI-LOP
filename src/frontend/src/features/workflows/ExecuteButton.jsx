import React, { useState } from 'react';
import { workflowsApi } from '../../services/api/workflows.js';

export default function ExecuteButton({ workflowId, onExecuted, disabled }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const handleClick = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await workflowsApi.execute(workflowId);
      onExecuted?.(result);
    } catch (err) {
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
