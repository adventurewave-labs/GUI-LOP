import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { workflowsApi } from '../../services/api/workflows.js';

export default function CreateWorkflow() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [template, setTemplate] = useState(params.get('template') || '');
  const [contextJson, setContextJson] = useState('{}');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    let context;
    try {
      context = JSON.parse(contextJson || '{}');
    } catch (err) {
      setError('Context must be valid JSON');
      setSubmitting(false);
      return;
    }
    try {
      const result = await workflowsApi.create({ template, context });
      const id = result?.workflow_id ?? result?.workflowId ?? result?.id;
      if (id) {
        navigate(`/workflows/${id}`);
      }
    } catch (err) {
      setError(err.message || 'Failed to create workflow');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div data-testid="create-workflow">
      <h2>Create workflow</h2>
      {error && <div className="auth-error" role="alert">{error}</div>}
      <form onSubmit={handleSubmit}>
        <label>
          Template key
          <input
            type="text"
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            required
            data-testid="create-template"
          />
        </label>
        <label>
          Context (JSON)
          <textarea
            value={contextJson}
            onChange={(e) => setContextJson(e.target.value)}
            rows={6}
            data-testid="create-context"
          />
        </label>
        <button type="submit" disabled={submitting} data-testid="create-submit">
          {submitting ? 'Creating...' : 'Create workflow'}
        </button>
      </form>
    </div>
  );
}
