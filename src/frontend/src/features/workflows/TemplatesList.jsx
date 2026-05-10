import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { workflowsApi } from '../../services/api/workflows.js';
import { ApiError } from '../../services/api/client.js';

export default function TemplatesList() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const list = await workflowsApi.listTemplates({ activeOnly: true });
        if (mounted) setTemplates(list);
      } catch (err) {
        if (mounted) {
          setError(err instanceof ApiError ? err.message : 'Failed to load templates');
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  if (loading) return <div data-testid="templates-loading">Loading templates...</div>;
  if (error) return <div className="auth-error" role="alert">{error}</div>;

  return (
    <div data-testid="templates-list">
      <h2>Workflow templates</h2>
      {templates.length === 0 ? (
        <p>No templates available.</p>
      ) : (
        <ul className="template-list">
          {templates.map((t) => {
            const key = t.key ?? t.id ?? t.template_key;
            return (
              <li key={key} className="template-item" data-testid={`template-${key}`}>
                <h3>{t.name ?? key}</h3>
                {t.description && <p>{t.description}</p>}
                <Link to={`/workflows/new?template=${encodeURIComponent(key)}`}>
                  Start workflow
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
