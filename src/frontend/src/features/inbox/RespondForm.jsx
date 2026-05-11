import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { inboxApi } from '../../services/api/inbox.js';

/**
 * Renders a dynamic form from a `ui_spec` produced by the UI generation
 * service. The spec is intentionally minimal — we support `text`,
 * `textarea`, `select`, `checkbox` and a small `actions` array mirroring
 * the backend `RecordHumanResponse` action vocabulary
 * (`approve`, `reject`, `escalate`).
 */
export default function RespondForm() {
  const { workflowId, stepId } = useParams();
  const navigate = useNavigate();
  const [step, setStep] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [values, setValues] = useState({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const detail = await inboxApi.getPendingStep(workflowId, stepId);
        if (mounted) setStep(detail);
      } catch (err) {
        if (mounted) setError(err.message || 'Failed to load step');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [workflowId, stepId]);

  const submit = async (action) => {
    setSubmitting(true);
    setError(null);
    try {
      await inboxApi.respond({
        workflowId,
        stepId,
        action,
        payload: values,
      });
      navigate(`/workflows/${encodeURIComponent(workflowId)}`);
    } catch (err) {
      setError(err.message || 'Failed to submit response');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div data-testid="respond-loading">Loading step...</div>;
  if (error) return <div className="auth-error" role="alert">{error}</div>;
  if (!step) return <div>Step not found</div>;

  const uiSpec = step.uiSpec ?? step.ui_spec ?? {};
  const fields = Array.isArray(uiSpec.fields) ? uiSpec.fields : [];
  const actions = Array.isArray(uiSpec.actions) && uiSpec.actions.length > 0
    ? uiSpec.actions
    : ['approve', 'reject'];

  return (
    <div data-testid="respond-form">
      <h2>{uiSpec.title || `Respond to step ${stepId}`}</h2>
      {uiSpec.description && <p>{uiSpec.description}</p>}
      {fields.map((field) => {
        const id = `field-${field.name}`;
        const value = values[field.name] ?? '';
        const onChange = (e) =>
          setValues((prev) => ({
            ...prev,
            [field.name]: field.type === 'checkbox' ? e.target.checked : e.target.value,
          }));
        return (
          <div key={field.name} className="form-group">
            <label htmlFor={id}>{field.label || field.name}</label>
            {field.type === 'textarea' ? (
              <textarea id={id} value={value} onChange={onChange} data-testid={id} />
            ) : field.type === 'select' ? (
              <select id={id} value={value} onChange={onChange} data-testid={id}>
                <option value="">--</option>
                {(field.options || []).map((opt) => (
                  <option key={opt.value ?? opt} value={opt.value ?? opt}>
                    {opt.label ?? opt}
                  </option>
                ))}
              </select>
            ) : field.type === 'checkbox' ? (
              <input
                id={id}
                type="checkbox"
                checked={!!values[field.name]}
                onChange={onChange}
                data-testid={id}
              />
            ) : (
              <input
                id={id}
                type="text"
                value={value}
                onChange={onChange}
                data-testid={id}
              />
            )}
          </div>
        );
      })}
      <div className="form-actions">
        {actions.map((action) => (
          <button
            key={action}
            type="button"
            onClick={() => submit(action)}
            disabled={submitting}
            data-testid={`respond-${action}`}
          >
            {submitting ? '...' : action}
          </button>
        ))}
      </div>
    </div>
  );
}
