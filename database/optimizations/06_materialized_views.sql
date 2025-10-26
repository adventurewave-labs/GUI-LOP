-- =====================================================
-- GUI-LOP Database Performance Optimization
-- Week 5-6 Phase 2: Materialized Views for Workflow Optimization
-- =====================================================

-- =====================================================
-- 1. MATERIALIZED VIEWS FOR WORKFLOW LISTING
-- =====================================================

-- Materialized view for workflow listing with user information
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_workflow_listing AS
SELECT
    w.id,
    w.title,
    w.description,
    w.status,
    w.template_key,
    w.created_at,
    w.updated_at,
    w.started_at,
    w.completed_at,
    w.created_by,
    u.username as created_by_username,
    u.full_name as created_by_full_name,
    u.email as created_by_email,
    t.name as template_name,
    t.description as template_description,
    -- Computed fields
    CASE
        WHEN w.status = 'running' THEN EXTRACT(EPOCH FROM (NOW() - w.started_at))
        WHEN w.status = 'waiting_for_human' THEN EXTRACT(EPOCH FROM (NOW() - w.started_at))
        WHEN w.completed_at IS NOT NULL THEN EXTRACT(EPOCH FROM (w.completed_at - w.started_at))
        ELSE NULL
    END as duration_seconds,
    -- Status grouping for filtering
    CASE
        WHEN w.status IN ('created', 'running', 'waiting_for_human') THEN 'active'
        WHEN w.status IN ('completed', 'failed', 'cancelled') THEN 'completed'
        ELSE 'other'
    END as status_group,
    -- Priority indicators
    CASE
        WHEN w.status = 'waiting_for_human' THEN 3
        WHEN w.status = 'running' THEN 2
        WHEN w.status = 'created' THEN 1
        ELSE 0
    END as priority_score,
    -- Human interaction count
    COALESCE(hr.human_count, 0) as human_interaction_count,
    -- Step progress
    COALESCE(ws.total_steps, 0) as total_steps,
    COALESCE(ws.completed_steps, 0) as completed_steps,
    CASE
        WHEN ws.total_steps > 0 THEN ROUND((ws.completed_steps::numeric / ws.total_steps) * 100, 2)
        ELSE 0
    END as completion_percentage
FROM workflows w
LEFT JOIN users u ON w.created_by = u.id
LEFT JOIN workflow_templates t ON w.template_key = t.template_key
LEFT JOIN (
    SELECT workflow_id, COUNT(*) as human_count
    FROM human_responses
    GROUP BY workflow_id
) hr ON w.id = hr.workflow_id
LEFT JOIN (
    SELECT workflow_id,
           COUNT(*) as total_steps,
           COUNT(CASE WHEN status IN ('completed', 'failed', 'cancelled') THEN 1 END) as completed_steps
    FROM workflow_steps
    GROUP BY workflow_id
) ws ON w.id = ws.workflow_id
WHERE w.created_at > NOW() - INTERVAL '90 days'  -- Only recent workflows
WITH DATA;

-- Create unique index for materialized view refresh
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_workflow_listing_id
ON mv_workflow_listing (id);

-- Create indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_mv_workflow_listing_status_created
ON mv_workflow_listing (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mv_workflow_listing_user_created
ON mv_workflow_listing (created_by, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mv_workflow_listing_template_status
ON mv_workflow_listing (template_key, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mv_workflow_listing_status_group
ON mv_workflow_listing (status_group, priority_score DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mv_workflow_listing_priority
ON mv_workflow_listing (priority_score DESC, created_at DESC)
WHERE status IN ('created', 'running', 'waiting_for_human');

-- Full-text search index for workflow titles
CREATE INDEX IF NOT EXISTS idx_mv_workflow_listing_title_fts
ON mv_workflow_listing USING gin(to_tsvector('english', title || ' ' || COALESCE(description, '')));

-- =====================================================
-- 2. MATERIALIZED VIEW FOR WORKFLOW ANALYTICS
-- =====================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_workflow_analytics AS
SELECT
    -- Time dimensions
    DATE_TRUNC('day', w.created_at) as date,
    DATE_TRUNC('week', w.created_at) as week,
    DATE_TRUNC('month', w.created_at) as month,
    -- Template dimensions
    w.template_key,
    t.name as template_name,
    -- Status analytics
    w.status,
    COUNT(*) as workflow_count,
    -- Duration analytics
    ROUND(AVG(
        CASE
            WHEN w.completed_at IS NOT NULL AND w.started_at IS NOT NULL THEN
                EXTRACT(EPOCH FROM (w.completed_at - w.started_at))
            ELSE NULL
        END
    ), 2) as avg_duration_seconds,
    ROUND(PERCENTILE_CONT(0.50) WITHIN GROUP (
        ORDER BY CASE
            WHEN w.completed_at IS NOT NULL AND w.started_at IS NOT NULL THEN
                EXTRACT(EPOCH FROM (w.completed_at - w.started_at))
            ELSE NULL
        END
    ), 2) as median_duration_seconds,
    ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (
        ORDER BY CASE
            WHEN w.completed_at IS NOT NULL AND w.started_at IS NOT NULL THEN
                EXTRACT(EPOCH FROM (w.completed_at - w.started_at))
            ELSE NULL
        END
    ), 2) as p95_duration_seconds,
    -- Success rate
    COUNT(CASE WHEN w.status = 'completed' THEN 1 END)::numeric / COUNT(*) as success_rate,
    -- Human interaction analytics
    COALESCE(AVG(hr.human_count), 0) as avg_human_interactions,
    COALESCE(SUM(hr.human_count), 0) as total_human_interactions,
    -- Step analytics
    COALESCE(AVG(ws.total_steps), 0) as avg_total_steps,
    COALESCE(AVG(ws.completed_steps), 0) as avg_completed_steps,
    -- User activity
    COUNT(DISTINCT w.created_by) as unique_users,
    -- Time-based metrics
    COUNT(CASE WHEN w.created_at > NOW() - INTERVAL '1 hour' THEN 1 END) as last_hour_count,
    COUNT(CASE WHEN w.created_at > NOW() - INTERVAL '24 hours' THEN 1 END) as last_24h_count,
    COUNT(CASE WHEN w.created_at > NOW() - INTERVAL '7 days' THEN 1 END) as last_7d_count
FROM workflows w
LEFT JOIN workflow_templates t ON w.template_key = t.template_key
LEFT JOIN (
    SELECT workflow_id, COUNT(*) as human_count
    FROM human_responses
    GROUP BY workflow_id
) hr ON w.id = hr.workflow_id
LEFT JOIN (
    SELECT workflow_id,
           COUNT(*) as total_steps,
           COUNT(CASE WHEN status IN ('completed', 'failed', 'cancelled') THEN 1 END) as completed_steps
    FROM workflow_steps
    GROUP BY workflow_id
) ws ON w.id = ws.workflow_id
WHERE w.created_at > NOW() - INTERVAL '1 year'
GROUP BY
    DATE_TRUNC('day', w.created_at),
    DATE_TRUNC('week', w.created_at),
    DATE_TRUNC('month', w.created_at),
    w.template_key,
    t.name,
    w.status
WITH DATA;

-- Create indexes for analytics queries
CREATE INDEX IF NOT EXISTS idx_mv_workflow_analytics_date ON mv_workflow_analytics (date DESC);
CREATE INDEX IF NOT EXISTS idx_mv_workflow_analytics_week ON mv_workflow_analytics (week DESC);
CREATE INDEX IF NOT EXISTS idx_mv_workflow_analytics_month ON mv_workflow_analytics (month DESC);
CREATE INDEX IF NOT EXISTS idx_mv_workflow_analytics_template ON mv_workflow_analytics (template_key, date DESC);
CREATE INDEX IF NOT EXISTS idx_mv_workflow_analytics_status ON mv_workflow_analytics (status, date DESC);
CREATE INDEX IF NOT EXISTS idx_mv_workflow_analytics_count ON mv_workflow_analytics (workflow_count DESC);

-- =====================================================
-- 3. MATERIALIZED VIEW FOR USER ACTIVITY DASHBOARD
-- =====================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_user_activity_dashboard AS
SELECT
    -- User information
    u.id as user_id,
    u.username,
    u.full_name,
    u.email,
    u.role,
    u.last_login,
    -- Workflow counts
    COUNT(DISTINCT w.id) as total_workflows,
    COUNT(DISTINCT CASE WHEN w.status IN ('created', 'running', 'waiting_for_human') THEN w.id END) as active_workflows,
    COUNT(DISTINCT CASE WHEN w.status = 'completed' THEN w.id END) as completed_workflows,
    COUNT(DISTINCT CASE WHEN w.status = 'failed' THEN w.id END) as failed_workflows,
    -- Success rate
    CASE
        WHEN COUNT(DISTINCT w.id) > 0 THEN
            COUNT(DISTINCT CASE WHEN w.status = 'completed' THEN w.id END)::numeric / COUNT(DISTINCT w.id)
        ELSE 0
    END as success_rate,
    -- Activity metrics
    COUNT(DISTINCT s.id) as total_sessions,
    MAX(s.created_at) as last_session,
    COUNT(DISTINCT CASE WHEN s.created_at > NOW() - INTERVAL '7 days' THEN s.id END) as recent_sessions,
    -- Human interactions
    COUNT(DISTINCT h.id) as total_human_responses,
    COUNT(DISTINCT CASE WHEN h.created_at > NOW() - INTERVAL '7 days' THEN h.id END) as recent_human_responses,
    -- Average workflow duration
    ROUND(AVG(
        CASE
            WHEN w.completed_at IS NOT NULL AND w.started_at IS NOT NULL THEN
                EXTRACT(EPOCH FROM (w.completed_at - w.started_at))
            ELSE NULL
        END
    ), 2) as avg_workflow_duration_seconds,
    -- Template preferences
    COUNT(DISTINCT CASE WHEN w.template_key = 'data-analysis' THEN w.id END) as data_analysis_count,
    COUNT(DISTINCT CASE WHEN w.template_key = 'decision-making' THEN w.id END) as decision_making_count,
    COUNT(DISTINCT CASE WHEN w.template_key = 'content-creation' THEN w.id END) as content_creation_count,
    -- Time-based activity
    COUNT(DISTINCT CASE WHEN w.created_at > NOW() - INTERVAL '1 hour' THEN w.id END) as last_hour_workflows,
    COUNT(DISTINCT CASE WHEN w.created_at > NOW() - INTERVAL '24 hours' THEN w.id END) as last_24h_workflows,
    COUNT(DISTINCT CASE WHEN w.created_at > NOW() - INTERVAL '7 days' THEN w.id END) as last_7d_workflows,
    -- Performance metrics
    ROUND(AVG(
        CASE
            WHEN w.completed_at IS NOT NULL AND w.started_at IS NOT NULL THEN
                EXTRACT(EPOCH FROM (w.completed_at - w.started_at))
            ELSE NULL
        END
    ), 2) as avg_execution_time_seconds,
    -- User activity score (for leaderboards)
    ROUND(
        (COUNT(DISTINCT w.id) * 10 +
         COUNT(DISTINCT h.id) * 5 +
         COUNT(DISTINCT CASE WHEN w.status = 'completed' THEN w.id END) * 20) *
        CASE
            WHEN u.last_login > NOW() - INTERVAL '7 days' THEN 1.0
            WHEN u.last_login > NOW() - INTERVAL '30 days' THEN 0.5
            ELSE 0.1
        END, 2
    ) as activity_score
FROM users u
LEFT JOIN workflows w ON u.id = w.created_by AND w.created_at > NOW() - INTERVAL '90 days'
LEFT JOIN user_sessions s ON u.id = s.user_id AND s.created_at > NOW() - INTERVAL '90 days'
LEFT JOIN human_responses h ON u.id = h.user_id AND h.created_at > NOW() - INTERVAL '90 days'
GROUP BY u.id, u.username, u.full_name, u.email, u.role, u.last_login
WITH DATA;

-- Create indexes for user activity queries
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_user_activity_user_id ON mv_user_activity_dashboard (user_id);
CREATE INDEX IF NOT EXISTS idx_mv_user_activity_score ON mv_user_activity_dashboard (activity_score DESC);
CREATE INDEX IF NOT EXISTS idx_mv_user_activity_workflows ON mv_user_activity_dashboard (total_workflows DESC);
CREATE INDEX IF NOT EXISTS idx_mv_user_activity_recent ON mv_user_activity_dashboard (last_session DESC);
CREATE INDEX IF NOT EXISTS idx_mv_user_activity_role ON mv_user_activity_dashboard (role, activity_score DESC);

-- =====================================================
-- 4. MATERIALIZED VIEW FOR EVENT ANALYTICS
-- =====================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_event_analytics AS
SELECT
    -- Time dimensions
    DATE_TRUNC('hour', e.created_at) as hour_bucket,
    DATE_TRUNC('day', e.created_at) as date_bucket,
    DATE_TRUNC('week', e.created_at) as week_bucket,
    -- Event dimensions
    e.event_type,
    -- Workflow dimensions
    w.template_key,
    COALESCE(w.status, 'unknown') as workflow_status,
    -- User dimensions
    u.role as user_role,
    -- Counts
    COUNT(*) as event_count,
    COUNT(DISTINCT e.workflow_id) as unique_workflows,
    COUNT(DISTINCT e.user_id) as unique_users,
    COUNT(DISTINCT e.session_id) as unique_sessions,
    -- Time-based distributions
    COUNT(CASE WHEN e.created_at > NOW() - INTERVAL '1 hour' THEN 1 END) as last_hour_count,
    COUNT(CASE WHEN e.created_at > NOW() - INTERVAL '24 hours' THEN 1 END) as last_24h_count,
    -- Event patterns
    CASE
        WHEN e.event_type = 'workflow_created' THEN COUNT(*)
        ELSE 0
    END as workflow_created_count,
    CASE
        WHEN e.event_type = 'workflow_completed' THEN COUNT(*)
        ELSE 0
    END as workflow_completed_count,
    CASE
        WHEN e.event_type = 'human_response' THEN COUNT(*)
        ELSE 0
    END as human_response_count,
    CASE
        WHEN e.event_type = 'system_event' THEN COUNT(*)
        ELSE 0
    END as system_event_count,
    -- Error tracking
    COUNT(CASE WHEN e.event_data->>'error' IS NOT NULL THEN 1 END) as error_count,
    -- Performance metrics
    ROUND(AVG(
        CASE
            WHEN e.event_data->>'execution_time' IS NOT NULL THEN
                (e.event_data->>'execution_time')::numeric
            ELSE NULL
        END
    ), 2) as avg_execution_time_ms
FROM events e
LEFT JOIN workflows w ON e.workflow_id = w.id
LEFT JOIN users u ON e.user_id = u.id
WHERE e.created_at > NOW() - INTERVAL '90 days'
GROUP BY
    DATE_TRUNC('hour', e.created_at),
    DATE_TRUNC('day', e.created_at),
    DATE_TRUNC('week', e.created_at),
    e.event_type,
    w.template_key,
    w.status,
    u.role
WITH DATA;

-- Create indexes for event analytics
CREATE INDEX IF NOT EXISTS idx_mv_event_analytics_hour ON mv_event_analytics (hour_bucket DESC);
CREATE INDEX IF NOT EXISTS idx_mv_event_analytics_date ON mv_event_analytics (date_bucket DESC);
CREATE INDEX IF NOT EXISTS idx_mv_event_analytics_type ON mv_event_analytics (event_type, date_bucket DESC);
CREATE INDEX IF NOT EXISTS idx_mv_event_analytics_template ON mv_event_analytics (template_key, date_bucket DESC);
CREATE INDEX IF NOT EXISTS idx_mv_event_analytics_count ON mv_event_analytics (event_count DESC);

-- =====================================================
-- 5. MATERIALIZED VIEW REFRESH FUNCTIONS
-- =====================================================

-- Function to refresh workflow listing materialized view
CREATE OR REPLACE FUNCTION refresh_workflow_listing()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_workflow_listing;

    -- Log refresh operation
    INSERT INTO system_metrics (metric_name, metric_value, metric_unit, metadata)
    VALUES ('materialized_view_refresh', 1, 'count',
            jsonb_build_object('view_name', 'mv_workflow_listing', 'timestamp', NOW()));
END;
$$ LANGUAGE plpgsql;

-- Function to refresh analytics materialized views
CREATE OR REPLACE FUNCTION refresh_analytics_views()
RETURNS void AS $$
BEGIN
    -- Refresh workflow analytics
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_workflow_analytics;

    -- Refresh user activity dashboard
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_user_activity_dashboard;

    -- Refresh event analytics
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_event_analytics;

    -- Log refresh operation
    INSERT INTO system_metrics (metric_name, metric_value, metric_unit, metadata)
    VALUES ('materialized_view_refresh', 3, 'count',
            jsonb_build_object(
                'views', 'mv_workflow_analytics, mv_user_activity_dashboard, mv_event_analytics',
                'timestamp', NOW()
            ));
END;
$$ LANGUAGE plpgsql;

-- Function to refresh all materialized views
CREATE OR REPLACE FUNCTION refresh_all_materialized_views()
RETURNS TABLE(view_name text, status text, refresh_time_ms integer) AS $$
DECLARE
    start_time TIMESTAMP;
    refresh_result RECORD;
BEGIN
    -- Create a temporary table to store results
    CREATE TEMPORARY TABLE IF NOT EXISTS refresh_results (
        view_name text,
        status text,
        refresh_time_ms integer
    );

    -- List of views to refresh
    FOR refresh_result IN
        SELECT 'mv_workflow_listing' as view_name
        UNION ALL
        SELECT 'mv_workflow_analytics' as view_name
        UNION ALL
        SELECT 'mv_user_activity_dashboard' as view_name
        UNION ALL
        SELECT 'mv_event_analytics' as view_name
    LOOP
        start_time := clock_timestamp();

        BEGIN
            EXECUTE 'REFRESH MATERIALIZED VIEW CONCURRENTLY ' || refresh_result.view_name;

            INSERT INTO refresh_results (view_name, status, refresh_time_ms)
            VALUES (refresh_result.view_name, 'success', EXTRACT(MILLISECONDS FROM (clock_timestamp() - start_time))::integer);

        EXCEPTION WHEN OTHERS THEN
            INSERT INTO refresh_results (view_name, status, refresh_time_ms)
            VALUES (refresh_result.view_name, 'failed: ' || SQLERRM, EXTRACT(MILLISECONDS FROM (clock_timestamp() - start_time))::integer);
        END;
    END LOOP;

    -- Return results
    RETURN QUERY SELECT * FROM refresh_results ORDER BY view_name;

    -- Clean up temporary table
    DROP TABLE IF EXISTS refresh_results;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 6. AUTOMATED REFRESH SCHEDULING
-- =====================================================

-- Function to get materialized view refresh statistics
CREATE OR REPLACE FUNCTION get_materialized_view_stats()
RETURNS TABLE(
    view_name text,
    last_refresh TIMESTAMPTZ,
    total_rows bigint,
    size_mb numeric,
    refresh_frequency INTERVAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        schemaname || '.' || matviewname as view_name,
        pg_stat_user_matviews.last_refresh,
        pg_stat_user_matviews.n_tup_ins as total_rows,
        pg_relation_size(schemaname||'.'||matviewname) / (1024.0 * 1024.0) as size_mb,
        CASE
            WHEN matviewname = 'mv_workflow_listing' THEN INTERVAL '5 minutes'
            WHEN matviewname = 'mv_user_activity_dashboard' THEN INTERVAL '1 hour'
            WHEN matviewname = 'mv_workflow_analytics' THEN INTERVAL '30 minutes'
            WHEN matviewname = 'mv_event_analytics' THEN INTERVAL '15 minutes'
            ELSE INTERVAL '1 hour'
        END as refresh_frequency
    FROM pg_stat_user_matviews
    JOIN pg_matviews USING (matviewname, schemaname)
    WHERE schemaname = 'public'
    ORDER BY pg_relation_size(schemaname||'.'||matviewname) DESC;
END;
$$ LANGUAGE plpgsql;

-- Function to check if materialized views need refreshing
CREATE OR REPLACE FUNCTION check_materialized_view_refresh_needed()
RETURNS TABLE(
    view_name text,
    needs_refresh boolean,
    time_since_last_refresh INTERVAL,
    recommended_action text
) AS $$
DECLARE
    view_record RECORD;
BEGIN
    -- Create temporary table for results
    CREATE TEMPORARY TABLE IF NOT EXISTS refresh_check_results (
        view_name text,
        needs_refresh boolean,
        time_since_last_refresh INTERVAL,
        recommended_action text
    );

    FOR view_record IN
        SELECT
            schemaname || '.' || matviewname as view_name,
            last_refresh,
            CASE
                WHEN matviewname = 'mv_workflow_listing' THEN INTERVAL '5 minutes'
                WHEN matviewname = 'mv_user_activity_dashboard' THEN INTERVAL '1 hour'
                WHEN matviewname = 'mv_workflow_analytics' THEN INTERVAL '30 minutes'
                WHEN matviewname = 'mv_event_analytics' THEN INTERVAL '15 minutes'
                ELSE INTERVAL '1 hour'
            END as refresh_frequency
        FROM pg_stat_user_matviews
        JOIN pg_matviews USING (matviewname, schemaname)
        WHERE schemaname = 'public'
    LOOP
        INSERT INTO refresh_check_results (view_name, needs_refresh, time_since_last_refresh, recommended_action)
        VALUES (
            view_record.view_name,
            COALESCE(NOW() - view_record.last_refresh, INTERVAL '1 day') > view_record.refresh_frequency,
            NOW() - COALESCE(view_record.last_refresh, NOW() - INTERVAL '1 day'),
            CASE
                WHEN COALESCE(NOW() - view_record.last_refresh, INTERVAL '1 day') > view_record.refresh_frequency THEN 'REFRESH_IMMEDIATELY'
                WHEN COALESCE(NOW() - view_record.last_refresh, INTERVAL '1 day') > (view_record.refresh_frequency * 0.8) THEN 'REFRESH_SOON'
                ELSE 'NO_ACTION_NEEDED'
            END
        );
    END LOOP;

    -- Return results
    RETURN QUERY SELECT * FROM refresh_check_results ORDER BY needs_refresh DESC, time_since_last_refresh DESC;

    -- Clean up
    DROP TABLE IF EXISTS refresh_check_results;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 7. MONITORING VIEWS FOR MATERIALIZED VIEWS
-- =====================================================

-- Materialized view dashboard
CREATE OR REPLACE VIEW materialized_view_dashboard AS
SELECT
    mvs.view_name,
    mvs.last_refresh,
    mvs.total_rows,
    mvs.size_mb,
    mvs.refresh_frequency,
    CASE
        WHEN NOW() - mvs.last_refresh > mvs.refresh_frequency THEN 'STALE'
        WHEN NOW() - mvs.last_refresh > (mvs.refresh_frequency * 0.8) THEN 'FRESH_SOON'
        ELSE 'FRESH'
    END as freshness_status,
    DATE_PART('epoch', NOW() - mvs.last_refresh)::integer as seconds_since_refresh,
    sm.n_tup_ins as inserts_since_refresh,
    sm.n_tup_upd as updates_since_refresh,
    sm.n_tup_del as deletes_since_refresh
FROM get_materialized_view_stats() mvs
LEFT JOIN pg_stat_user_matviews sm ON split_part(mvs.view_name, '.', 2) = sm.matviewname
ORDER BY mvs.size_mb DESC;

-- Materialized view refresh log view
CREATE OR REPLACE VIEW materialized_view_refresh_log AS
SELECT
    metric_name as view_name,
    created_at as refresh_timestamp,
    jsonb_extract_path_text(metadata, 'view_name') as specific_view,
    jsonb_extract_path_text(metadata, 'timestamp') as metadata_timestamp
FROM system_metrics
WHERE metric_name = 'materialized_view_refresh'
    AND created_at > NOW() - INTERVAL '7 days'
ORDER BY created_at DESC;

-- Materialized view performance comparison view
CREATE OR REPLACE VIEW materialized_view_performance AS
SELECT
    'materialized_view' as query_type,
    'mv_workflow_listing' as source_name,
    COUNT(*) as usage_count,
    ROUND(AVG(EXTRACT(MILLISECONDS FROM (now() - q.query_start))), 2) as avg_execution_time_ms
FROM pg_stat_activity q
WHERE q.query LIKE '%mv_workflow_listing%'
    AND q.state = 'active'
GROUP BY 'mv_workflow_listing'

UNION ALL

SELECT
    'direct_query' as query_type,
    'workflows_table' as source_name,
    COUNT(*) as usage_count,
    ROUND(AVG(EXTRACT(MILLISECONDS FROM (now() - q.query_start))), 2) as avg_execution_time_ms
FROM pg_stat_activity q
WHERE q.query LIKE '%workflows w%'
    AND q.query NOT LIKE '%mv_workflow_listing%'
    AND q.state = 'active'
GROUP BY 'workflows_table'
ORDER BY avg_execution_time_ms;

-- =====================================================
-- 8. AUTOMATED REFRESH TRIGGERS
-- =====================================================

-- Function to automatically refresh materialized views after significant data changes
CREATE OR REPLACE FUNCTION auto_refresh_on_data_change()
RETURNS TRIGGER AS $$
BEGIN
    -- Refresh workflow listing if workflows table changes significantly
    IF TG_TABLE_NAME = 'workflows' THEN
        -- Only refresh if this is a high-volume operation
        IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
            -- Schedule refresh for next available window
            -- In production, this would use a job scheduler
            PERFORM pg_notify('mv_refresh_needed', 'mv_workflow_listing');
        END IF;
    ELSIF TG_TABLE_NAME = 'users' THEN
        -- Refresh user activity dashboard when user data changes
        PERFORM pg_notify('mv_refresh_needed', 'mv_user_activity_dashboard');
    ELSIF TG_TABLE_NAME = 'events' THEN
        -- Refresh event analytics periodically
        PERFORM pg_notify('mv_refresh_needed', 'mv_event_analytics');
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Create notification listener for manual refresh (optional setup)
-- LISTEN mv_refresh_needed;

-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION refresh_workflow_listing() TO PUBLIC;
GRANT EXECUTE ON FUNCTION refresh_analytics_views() TO PUBLIC;
GRANT EXECUTE ON FUNCTION refresh_all_materialized_views() TO PUBLIC;
GRANT EXECUTE ON FUNCTION get_materialized_view_stats() TO PUBLIC;
GRANT EXECUTE ON FUNCTION check_materialized_view_refresh_needed() TO PUBLIC;

-- Grant access to monitoring views
GRANT SELECT ON materialized_view_dashboard TO PUBLIC;
GRANT SELECT ON materialized_view_refresh_log TO PUBLIC;
GRANT SELECT ON materialized_view_performance TO PUBLIC;

-- Set up scheduled refresh jobs (requires pg_cron extension)
-- SELECT cron.schedule('refresh-workflow-listing', '*/5 * * * *', 'SELECT refresh_workflow_listing();');
-- SELECT cron.schedule('refresh-analytics-views', '*/30 * * * *', 'SELECT refresh_analytics_views();');
-- SELECT cron.schedule('refresh-user-dashboard', '0 * * * *', 'SELECT REFRESH MATERIALIZED VIEW CONCURRENTLY mv_user_activity_dashboard;');

-- Log materialized views setup completion
INSERT INTO system_metrics (metric_name, metric_value, metric_unit, metadata)
VALUES ('database_materialized_views_configured', 4, 'count',
        '{"timestamp": "' || NOW() || '", "phase": "week5-6_phase2", "views": ["mv_workflow_listing", "mv_workflow_analytics", "mv_user_activity_dashboard", "mv_event_analytics"]}');

\echo 'Database materialized views optimization completed successfully!'
\echo 'Materialized views created:'
\echo '- mv_workflow_listing: Optimized workflow listing with user data'
\echo '- mv_workflow_analytics: Comprehensive workflow analytics'
\echo '- mv_user_activity_dashboard: User activity and performance metrics'
\echo '- mv_event_analytics: Event-based analytics and monitoring'
\echo '- Automated refresh functions and monitoring'
\echo '- Performance comparison and optimization views'