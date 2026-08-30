-- =====================================================
-- GUI-LOP Database Performance Optimization
-- Week 5-6 Phase 2: Advanced Indexing Strategy
-- =====================================================

-- Enable required extensions for performance monitoring
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gin;
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- =====================================================
-- 1. COMPREHENSIVE INDEXING STRATEGY
-- =====================================================

-- ---- Workflow Performance Indexes ----

-- Composite index for workflow listing queries (most common)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_workflows_listing_composite
ON workflows(status, created_at DESC, created_by)
WHERE status IN ('created', 'running', 'waiting_for_human');

-- Index for workflow template usage analytics
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_workflows_template_analytics
ON workflows(template_key, created_at DESC, status);

-- Full-text search index for workflow titles and descriptions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_workflows_title_fts
ON workflows USING gin(to_tsvector('english', title || ' ' || COALESCE(description, '')));

-- Index for workflow context JSON queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_workflows_context_gin
ON workflows USING gin(context);

-- Partial index for active workflows only
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_workflows_active_partial
ON workflows(created_at DESC, updated_at DESC)
WHERE status IN ('created', 'running', 'waiting_for_human');

-- Workflow time-based analysis indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_workflows_execution_time
ON workflows(started_at, completed_at)
WHERE started_at IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_workflows_completion_analysis
ON workflows(status, completed_at DESC)
WHERE status IN ('completed', 'failed', 'cancelled');

-- ---- User Session Performance Indexes ----

-- Composite index for active session queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_active_composite
ON user_sessions(user_id, expires_at DESC, created_at DESC)
WHERE is_active = true AND expires_at > NOW();

-- Index for session cleanup operations
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_expiry_cleanup
ON user_sessions(expires_at, is_active)
WHERE expires_at < NOW() OR is_active = false;

-- IP address-based session lookup for security
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_ip_security
ON user_sessions(ip_address, created_at DESC)
WHERE ip_address IS NOT NULL;

-- ---- Event Logging Performance Indexes ----

-- Time-series optimized index for events
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_events_timeseries
ON events(created_at DESC, event_type, workflow_id)
WHERE created_at > NOW() - INTERVAL '30 days';

-- Composite index for event analytics
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_events_analytics_composite
ON events(event_type, created_at DESC, user_id)
INCLUDE (workflow_id, session_id);

-- Partial index for recent events (most frequently accessed)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_events_recent_partial
ON events(created_at DESC, workflow_id, event_type)
WHERE created_at > NOW() - INTERVAL '7 days';

-- Event data JSON index for structured queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_events_data_gin
ON events USING gin(event_data);

-- ---- Workflow Steps Performance Indexes ----

-- Execution path optimization index
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_workflow_steps_execution
ON workflow_steps(workflow_id, step_order, status)
WHERE status IN ('created', 'running');

-- Step timing analysis index
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_workflow_steps_timing
ON workflow_steps(status, started_at, completed_at)
WHERE started_at IS NOT NULL;

-- Error tracking index
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_workflow_steps_errors
ON workflow_steps(status, error_message, created_at DESC)
WHERE error_message IS NOT NULL;

-- ---- Human Responses Performance Indexes ----

-- Response time analysis index
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_human_responses_timing
ON human_responses(workflow_id, created_at DESC, user_id);

-- Confidence score analysis index
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_human_responses_confidence
ON human_responses(confidence_score, created_at DESC)
WHERE confidence_score IS NOT NULL;

-- Action-based lookup index
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_human_responses_action
ON human_responses(action, created_at DESC);

-- ---- Audit Logs Performance Indexes ----

-- Audit trail optimization
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_trail
ON audit_logs(changed_at DESC, table_name, operation)
WHERE changed_at > NOW() - INTERVAL '90 days';

-- User activity tracking index
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_user_activity
ON audit_logs(changed_by, changed_at DESC, table_name)
WHERE changed_by IS NOT NULL;

-- Record change tracking index
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_record_changes
ON audit_logs(table_name, record_id, changed_at DESC);

-- ---- API Keys Performance Indexes ----

-- Active key lookup optimization
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_api_keys_active_usage
ON api_keys(is_active, last_used DESC)
WHERE is_active = true AND (expires_at IS NULL OR expires_at > NOW());

-- Key expiration management index
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_api_keys_expiration
ON api_keys(expires_at, is_active)
WHERE expires_at IS NOT NULL;

-- ---- Workflow Templates Performance Indexes ----

-- Template popularity index
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_workflow_templates_usage
ON workflow_templates(template_key, is_active, created_at DESC)
WHERE is_active = true;

-- Template search index
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_workflow_templates_search
ON workflow_templates USING gin(to_tsvector('english', name || ' ' || COALESCE(description, '')));

-- ---- System Configuration Performance Indexes ----

-- Configuration lookup optimization
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_system_config_lookup
ON system_config(config_key, is_public)
WHERE is_public = true;

-- ---- Workflow Metrics Performance Indexes ----

-- Performance analytics index
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_workflow_metrics_performance
ON workflow_metrics(created_at DESC, execution_time_ms, success_rate);

-- Template performance comparison index
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_workflow_metrics_template_comparison
ON workflow_metrics(workflow_id, success_rate, execution_time_ms);

-- =====================================================
-- 2. PARTIAL INDEXES FOR SPECIFIC USE CASES
-- =====================================================

-- High-priority workflows index
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_workflows_high_priority
ON workflows(created_at DESC, updated_at DESC)
WHERE status = 'waiting_for_human';

-- Failed workflow analysis index
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_workflows_failure_analysis
ON workflows(template_key, failed_at DESC, status)
WHERE status = 'failed' AND failed_at IS NOT NULL;

-- Recent user activity index
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_recent_activity
ON users(last_login DESC, id)
WHERE last_login > NOW() - INTERVAL '30 days';

-- Expired sessions cleanup index
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_expired_cleanup
ON user_sessions(expires_at)
WHERE expires_at < NOW();

-- =====================================================
-- 3. COVERING INDEXES FOR COMMON QUERIES
-- =====================================================

-- Workflow listing covering index
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_workflows_listing_covering
ON workflows(status, created_at DESC)
INCLUDE (id, title, template_key, created_by, created_at, updated_at);

-- Event analytics covering index
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_events_analytics_covering
ON events(event_type, created_at DESC)
INCLUDE (workflow_id, user_id, session_id);

-- User session covering index
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_user_covering
ON user_sessions(user_id, is_active)
INCLUDE (id, session_token, created_at, expires_at, ip_address);

-- =====================================================
-- 4. JSON PATH INDEXES FOR STRUCTURED DATA
-- =====================================================

-- Workflow configuration JSON index
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_workflows_config_paths
ON workflows USING gin((config::jsonb));

-- Workflow context specific path index
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_workflows_context_priority
ON workflows USING gin((context->>'priority'));

-- Event data path index
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_events_data_paths
ON events USING gin((event_data::jsonb));

-- =====================================================
-- 5. MAINTENANCE AND OPTIMIZATION
-- =====================================================

-- Function to update table statistics
CREATE OR REPLACE FUNCTION update_table_statistics()
RETURNS void AS $$
BEGIN
    -- Update statistics for large tables
    ANALYZE workflows;
    ANALYZE events;
    ANALYZE user_sessions;
    ANALYZE workflow_steps;
    ANALYZE human_responses;
    ANALYZE audit_logs;

    -- Log statistics update
    INSERT INTO system_metrics (metric_name, metric_value, metric_unit, metadata)
    VALUES ('table_statistics_updated', 1, 'count', '{"timestamp": "' || NOW() || '"}');
END;
$$ LANGUAGE plpgsql;

-- Function to check index usage
CREATE OR REPLACE FUNCTION check_index_usage()
RETURNS TABLE(
    schemaname name,
    tablename name,
    indexname name,
    idx_scan bigint,
    idx_tup_read bigint,
    idx_tup_fetch bigint,
    usage_percentage numeric
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        pg_stat_user_indexes.schemaname,
        pg_stat_user_indexes.relname::name,
        pg_stat_user_indexes.indexrelname::name,
        pg_stat_user_indexes.idx_scan,
        pg_stat_user_indexes.idx_tup_read,
        pg_stat_user_indexes.idx_tup_fetch,
        CASE
            WHEN pg_stat_user_indexes.idx_scan > 0 THEN
                ROUND((pg_stat_user_indexes.idx_scan::numeric /
                      (SELECT SUM(idx_scan) FROM pg_stat_user_indexes WHERE relname = pg_stat_user_indexes.relname)) * 100, 2)
            ELSE 0
        END as usage_percentage
    FROM pg_stat_user_indexes
    ORDER BY pg_stat_user_indexes.idx_scan DESC;
END;
$$ LANGUAGE plpgsql;

-- Function to identify unused indexes
CREATE OR REPLACE FUNCTION find_unused_indexes()
RETURNS TABLE(
    schemaname name,
    tablename name,
    indexname name,
    size_mb numeric
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        pg_stat_user_indexes.schemaname,
        pg_stat_user_indexes.relname::name,
        pg_stat_user_indexes.indexrelname::name,
        pg_relation_size(pg_stat_user_indexes.indexrelid) / (1024 * 1024)::numeric as size_mb
    FROM pg_stat_user_indexes
    WHERE pg_stat_user_indexes.idx_scan = 0
    AND pg_stat_user_indexes.schemaname = 'public'
    ORDER BY size_mb DESC;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 6. PERFORMANCE MONITORING VIEWS
-- =====================================================

-- View for index usage statistics
CREATE OR REPLACE VIEW index_performance_stats AS
SELECT
    schemaname,
    tablename,
    indexname,
    idx_scan as index_scans,
    idx_tup_read as tuples_read,
    idx_tup_fetch as tuples_fetched,
    pg_size_pretty(pg_relation_size(indexrelid)) as index_size,
    CASE
        WHEN idx_scan = 0 THEN 'UNUSED'
        WHEN idx_scan < 10 THEN 'LOW_USAGE'
        WHEN idx_scan < 100 THEN 'MEDIUM_USAGE'
        ELSE 'HIGH_USAGE'
    END as usage_level
FROM pg_stat_user_indexes
ORDER BY idx_scan DESC;

-- View for table size and performance
CREATE OR REPLACE VIEW table_performance_stats AS
SELECT
    schemaname,
    tablename,
    n_tup_ins as inserts,
    n_tup_upd as updates,
    n_tup_del as deletes,
    n_live_tup as live_tuples,
    n_dead_tup as dead_tuples,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as total_size,
    pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) as table_size
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- =====================================================
-- 7. AUTOMATIC INDEX MAINTENANCE
-- =====================================================

-- Create a scheduled job to update statistics (requires pg_cron extension)
-- SELECT cron.schedule('update-stats', '0 2 * * *', 'SELECT update_table_statistics();');

-- Create function to rebuild fragmented indexes
CREATE OR REPLACE FUNCTION rebuild_fragmented_indexes()
RETURNS TABLE(indexname name, status text) AS $$
DECLARE
    idx_record RECORD;
    fragmentation_threshold numeric := 0.3; -- 30% fragmentation threshold
BEGIN
    FOR idx_record IN
        SELECT
            indexrelname::name,
            (bloat::numeric / 100) as fragmentation_ratio
        FROM (
            SELECT
                indexrelname,
                CASE
                    WHEN relpages > 0 THEN
                        ROUND(((relpages - (reltuples / (current_setting('block_size')::integer / 24))) * 100 / relpages), 2)
                    ELSE 0
                END as bloat
            FROM pg_stat_user_indexes
            JOIN pg_class ON pg_class.oid = indexrelid
        ) subquery
        WHERE fragmentation_ratio > fragmentation_threshold
    LOOP
        BEGIN
            EXECUTE 'REINDEX INDEX CONCURRENTLY ' || idx_record.indexname;
            RETURN NEXT ROW(idx_record.indexname, 'REBUILT');
        EXCEPTION WHEN OTHERS THEN
            RETURN NEXT ROW(idx_record.indexname, 'FAILED: ' || SQLERRM);
        END;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION update_table_statistics() TO PUBLIC;
GRANT EXECUTE ON FUNCTION check_index_usage() TO PUBLIC;
GRANT EXECUTE ON FUNCTION find_unused_indexes() TO PUBLIC;
GRANT EXECUTE ON FUNCTION rebuild_fragmented_indexes() TO PUBLIC;

-- Create indexes performance metrics table
CREATE TABLE IF NOT EXISTS index_performance_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    index_name VARCHAR(255) NOT NULL,
    table_name VARCHAR(100) NOT NULL,
    metric_type VARCHAR(50) NOT NULL,
    metric_value NUMERIC NOT NULL,
    measured_at TIMESTAMPTZ DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_index_metrics_name_time ON index_performance_metrics(index_name, measured_at DESC);
CREATE INDEX idx_index_metrics_table_time ON index_performance_metrics(table_name, measured_at DESC);

-- Log indexing completion
INSERT INTO system_metrics (metric_name, metric_value, metric_unit, metadata)
VALUES ('database_optimization_indexing_completed', 1, 'count',
        '{"timestamp": "' || NOW() || '", "phase": "week5-6_phase2"}');

\echo 'Database indexing optimization completed successfully!'
\echo 'Key indexes created for:'
\echo '- Workflow queries and analytics'
\echo '- User session management'
\echo '- Event logging and monitoring'
\echo '- Performance optimization views'
\echo '- Maintenance and monitoring functions'
