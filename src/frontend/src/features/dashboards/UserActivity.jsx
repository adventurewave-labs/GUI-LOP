import React, { useEffect, useState } from 'react';
import { analyticsApi } from '../../services/api/analytics.js';
import { useAuth } from '../auth/useAuth.js';

export default function UserActivity() {
  const { user } = useAuth();
  const userId = user?.id ?? user?.userId;
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!userId) return undefined;
    let mounted = true;
    (async () => {
      try {
        const result = await analyticsApi.userActivity(userId);
        if (mounted) setStats(result);
      } catch (err) {
        if (mounted) setError(err.message || 'Failed to load activity');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [userId]);

  if (!userId) return <div>Sign in to see your activity.</div>;
  if (loading) return <div>Loading activity...</div>;
  if (error) return <div className="auth-error" role="alert">{error}</div>;

  return (
    <div data-testid="user-activity">
      <h2>Your activity</h2>
      <pre style={{ background: '#f5f5f5', padding: '1rem' }}>
        {JSON.stringify(stats, null, 2)}
      </pre>
    </div>
  );
}
