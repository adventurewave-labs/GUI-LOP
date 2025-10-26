-- =====================================================
-- GUI-LOP Database Performance Optimization
-- Week 5-6 Phase 2: Connection Pooling Configuration
-- =====================================================

-- =====================================================
-- 1. DATABASE CONNECTION POOLING SETUP
-- =====================================================

-- Create monitoring view for connection statistics
CREATE OR REPLACE VIEW connection_pool_stats AS
SELECT
    datname as database_name,
    numbackends as active_connections,
    xact_commit as transactions_committed,
    xact_rollback as transactions_rolled_back,
    blks_read as blocks_read,
    blks_hit as blocks_hit,
    tup_returned as tuples_returned,
    tup_fetched as tuples_fetched,
    tup_inserted as tuples_inserted,
    tup_updated as tuples_updated,
    tup_deleted as tuples_deleted,
    CASE
        WHEN blks_read > 0 THEN
            ROUND((blks_hit::numeric / (blks_read + blks_hit)) * 100, 2)
        ELSE 100
    END as cache_hit_ratio_percent
FROM pg_stat_database
WHERE datname = current_database();

-- Create connection usage tracking table
CREATE TABLE IF NOT EXISTS connection_usage_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    connection_type VARCHAR(50) NOT NULL, -- 'app', 'pool', 'admin', 'backup'
    connection_count INTEGER NOT NULL,
    active_connections INTEGER NOT NULL,
    idle_connections INTEGER NOT NULL,
    wait_time_ms INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_connection_usage_time ON connection_usage_log(created_at DESC);
CREATE INDEX idx_connection_usage_type ON connection_usage_log(connection_type, created_at DESC);

-- Function to log connection pool statistics
CREATE OR REPLACE FUNCTION log_connection_pool_stats()
RETURNS void AS $$
DECLARE
    active_conn INTEGER;
    total_conn INTEGER;
BEGIN
    -- Get current connection statistics
    SELECT count(*) INTO active_conn
    FROM pg_stat_activity
    WHERE state = 'active' AND datname = current_database();

    SELECT count(*) INTO total_conn
    FROM pg_stat_activity
    WHERE datname = current_database();

    -- Log the statistics
    INSERT INTO connection_usage_log (connection_type, connection_count, active_connections, idle_connections, metadata)
    VALUES (
        'app',
        total_conn,
        active_conn,
        total_conn - active_conn,
        jsonb_build_object(
            'timestamp', NOW(),
            'database', current_database(),
            'max_connections', current_setting('max_connections')::integer
        )
    );
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 2. PGBOUNCER CONFIGURATION TEMPLATES
-- =====================================================

-- Function to generate PgBouncer configuration
CREATE OR REPLACE FUNCTION generate_pgbouncer_config()
RETURNS TABLE(config_name text, config_value text) AS $$
BEGIN
    RETURN QUERY
    SELECT 'databases'::text, 'gui_lop = host=localhost port=5432 dbname=gui_lop'::text
    UNION ALL
    SELECT 'pgbouncer'::text, 'listen_port = 6432'::text
    UNION ALL
    SELECT 'pgbouncer'::text, 'listen_addr = 127.0.0.1'::text
    UNION ALL
    SELECT 'pgbouncer'::text, 'auth_type = md5'::text
    UNION ALL
    SELECT 'pgbouncer'::text, 'auth_file = /etc/pgbouncer/userlist.txt'::text
    UNION ALL
    SELECT 'pgbouncer'::text, 'logfile = /var/log/pgbouncer/pgbouncer.log'::text
    UNION ALL
    SELECT 'pgbouncer'::text, 'pidfile = /var/run/pgbouncer/pgbouncer.pid'::text
    UNION ALL
    SELECT 'pgbouncer'::text, 'admin_users = postgres'::text
    UNION ALL
    SELECT 'pgbouncer'::text, 'stats_users = stats, postgres'::text
    UNION ALL
    SELECT 'pgbouncer'::text, 'pool_mode = transaction'::text
    UNION ALL
    SELECT 'pgbouncer'::text, 'max_client_conn = 200'::text
    UNION ALL
    SELECT 'pgbouncer'::text, 'default_pool_size = 20'::text
    UNION ALL
    SELECT 'pgbouncer'::text, 'min_pool_size = 5'::text
    UNION ALL
    SELECT 'pgbouncer'::text, 'reserve_pool_size = 5'::text
    UNION ALL
    SELECT 'pgbouncer'::text, 'reserve_pool_timeout = 5'::text
    UNION ALL
    SELECT 'pgbouncer'::text, 'max_db_connections = 50'::text
    UNION ALL
    SELECT 'pgbouncer'::text, 'max_user_connections = 50'::text
    UNION ALL
    SELECT 'pgbouncer'::text, 'server_reset_query = DISCARD ALL'::text
    UNION ALL
    SELECT 'pgbouncer'::text, 'server_check_delay = 30'::text
    UNION ALL
    SELECT 'pgbouncer'::text, 'server_check_query = select 1'::text
    UNION ALL
    SELECT 'pgbouncer'::text, 'server_lifetime = 3600'::text
    UNION ALL
    SELECT 'pgbouncer'::text, 'server_idle_timeout = 600'::text
    UNION ALL
    SELECT 'pgbouncer'::text, 'query_timeout = 30000'::text
    UNION ALL
    SELECT 'pgbouncer'::text, 'query_wait_timeout = 120000'::text
    UNION ALL
    SELECT 'pgbouncer'::text, 'client_idle_timeout = 0'::text
    UNION ALL
    SELECT 'pgbouncer'::text, 'idle_timeout = 600'::text
    UNION ALL
    SELECT 'pgbouncer'::text, 'pkt_buf = 4096'::text
    UNION ALL
    SELECT 'pgbouncer'::text, 'listen_backlog = 128'::text
    UNION ALL
    SELECT 'pgbouncer'::text, 'sbuf_loopcnt = 5'::text
    UNION ALL
    SELECT 'pgbouncer'::text, 'suspend_timeout = 10'::text
    UNION ALL
    SELECT 'pgbouncer'::text, 'tcp_defer_accept = 0'::text
    UNION ALL
    SELECT 'pgbouncer'::text, 'tcp_keepalive = 1'::text
    UNION ALL
    SELECT 'pgbouncer'::text, 'tcp_keepcnt = 3'::text
    UNION ALL
    SELECT 'pgbouncer'::text, 'tcp_keepidle = 60'::text
    UNION ALL
    SELECT 'pgbouncer'::text, 'tcp_keepintvl = 30'::text
    UNION ALL
    SELECT 'pgbouncer'::text, 'ignore_startup_parameters = extra_float_digits'::text
    UNION ALL
    SELECT 'pgbouncer'::text, 'application_name_add_host = 1'::text
    UNION ALL
    SELECT 'pgbouncer'::text, 'track_extra_parameters = application_name'::text
    UNION ALL
    SELECT 'pgbouncer'::text, 'log_connections = 1'::text
    UNION ALL
    SELECT 'pgbouncer'::text, 'log_disconnections = 1'::text
    UNION ALL
    SELECT 'pgbouncer'::text, 'log_pooler_errors = 1'::text
    UNION ALL
    SELECT 'pgbouncer'::text, 'stats_period = 60'::text
    UNION ALL
    SELECT 'pgbouncer'::text, 'verbose = 0'::text;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 3. CONNECTION MONITORING FUNCTIONS
-- =====================================================

-- Function to get detailed connection statistics
CREATE OR REPLACE FUNCTION get_detailed_connection_stats()
RETURNS TABLE(
    database_name text,
    total_connections bigint,
    active_connections bigint,
    idle_connections bigint,
    waiting_connections bigint,
    avg_query_duration numeric,
    slow_queries bigint,
    blocked_queries bigint
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        d.datname,
        count(*) as total_connections,
        count(CASE WHEN a.state = 'active' THEN 1 END) as active_connections,
        count(CASE WHEN a.state = 'idle' THEN 1 END) as idle_connections,
        count(CASE WHEN a.wait_event_type = 'Lock' THEN 1 END) as waiting_connections,
        ROUND(AVG(EXTRACT(EPOCH FROM (now() - a.query_start))), 2) as avg_query_duration,
        count(CASE WHEN EXTRACT(EPOCH FROM (now() - a.query_start)) > 30 THEN 1 END) as slow_queries,
        count(CASE WHEN a.wait_event_type = 'Lock' AND a.wait_event IS NOT NULL THEN 1 END) as blocked_queries
    FROM pg_database d
    LEFT JOIN pg_stat_activity a ON d.oid = a.datid
    WHERE d.datname = current_database()
    GROUP BY d.datname;
END;
$$ LANGUAGE plpgsql;

-- Function to identify connection issues
CREATE OR REPLACE FUNCTION find_connection_issues()
RETURNS TABLE(
    issue_type text,
    severity text,
    description text,
    recommendation text,
    affected_connections bigint
) AS $$
BEGIN
    RETURN QUERY

    -- Check for too many connections
    SELECT
        'high_connection_count'::text,
        CASE
            WHEN (count(*)::float / current_setting('max_connections')::integer::float) > 0.9 THEN 'critical'
            WHEN (count(*)::float / current_setting('max_connections')::integer::float) > 0.8 THEN 'warning'
            ELSE 'info'
        END::text,
        'High number of active connections'::text,
        'Consider increasing max_connections or optimizing connection pooling'::text,
        count(*)::bigint
    FROM pg_stat_activity
    WHERE datname = current_database()
    GROUP BY count(*)::float / current_setting('max_connections')::integer::float
    HAVING (count(*)::float / current_setting('max_connections')::integer::float) > 0.8

    UNION ALL

    -- Check for long-running queries
    SELECT
        'long_running_queries'::text,
        CASE
            WHEN MAX(EXTRACT(EPOCH FROM (now() - query_start))) > 300 THEN 'critical'
            WHEN MAX(EXTRACT(EPOCH FROM (now() - query_start))) > 60 THEN 'warning'
            ELSE 'info'
        END::text,
        'Queries running for extended periods'::text,
        'Investigate and optimize long-running queries'::text,
        count(*)::bigint
    FROM pg_stat_activity
    WHERE state = 'active'
        AND query_start < now() - interval '30 seconds'
        AND datname = current_database()
    GROUP BY CASE
        WHEN MAX(EXTRACT(EPOCH FROM (now() - query_start))) > 300 THEN 'critical'
        WHEN MAX(EXTRACT(EPOCH FROM (now() - query_start))) > 60 THEN 'warning'
        ELSE 'info'
    END

    UNION ALL

    -- Check for blocked queries
    SELECT
        'blocked_queries'::text,
        CASE
            WHEN count(*) > 10 THEN 'critical'
            WHEN count(*) > 5 THEN 'warning'
            ELSE 'info'
        END::text,
        'Queries waiting on locks'::text,
        'Check for lock contention and optimize transactions'::text,
        count(*)::bigint
    FROM pg_stat_activity
    WHERE wait_event_type = 'Lock'
        AND datname = current_database()
    GROUP BY count(*)
    HAVING count(*) > 0;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 4. CONNECTION POOL PERFORMANCE METRICS
-- =====================================================

-- Create pool performance metrics table
CREATE TABLE IF NOT EXISTS pool_performance_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pool_type VARCHAR(50) NOT NULL, -- 'pgbouncer', 'native', 'none'
    total_connections INTEGER NOT NULL,
    active_connections INTEGER NOT NULL,
    idle_connections INTEGER NOT NULL,
    wait_count INTEGER NOT NULL,
    wait_time_ms INTEGER NOT NULL,
    avg_query_time_ms INTEGER,
    cache_hit_ratio DECIMAL(5,2),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_pool_metrics_time ON pool_performance_metrics(created_at DESC);
CREATE INDEX idx_pool_metrics_type ON pool_performance_metrics(pool_type, created_at DESC);

-- Function to record pool metrics
CREATE OR REPLACE FUNCTION record_pool_metrics(pool_type_param VARCHAR(50))
RETURNS void AS $$
DECLARE
    total_conn INTEGER;
    active_conn INTEGER;
    idle_conn INTEGER;
    cache_hit_ratio DECIMAL(5,2);
BEGIN
    -- Get connection statistics
    SELECT count(*) INTO total_conn
    FROM pg_stat_activity
    WHERE datname = current_database();

    SELECT count(*) INTO active_conn
    FROM pg_stat_activity
    WHERE state = 'active' AND datname = current_database();

    idle_conn := total_conn - active_conn;

    -- Calculate cache hit ratio
    SELECT CASE
        WHEN blks_read > 0 THEN
            ROUND((blks_hit::numeric / (blks_read + blks_hit)) * 100, 2)
        ELSE 100
    END INTO cache_hit_ratio
    FROM pg_stat_database
    WHERE datname = current_database();

    -- Insert metrics
    INSERT INTO pool_performance_metrics (
        pool_type,
        total_connections,
        active_connections,
        idle_connections,
        wait_count,
        wait_time_ms,
        cache_hit_ratio,
        metadata
    ) VALUES (
        pool_type_param,
        total_conn,
        active_conn,
        idle_conn,
        0, -- This would be populated by PgBouncer stats
        0, -- This would be populated by PgBouncer stats
        cache_hit_ratio,
        jsonb_build_object(
            'timestamp', NOW(),
            'database', current_database(),
            'max_connections', current_setting('max_connections')::integer
        )
    );
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 5. AUTOMATIC CONNECTION MANAGEMENT
-- =====================================================

-- Function to clean up idle connections
CREATE OR REPLACE FUNCTION cleanup_idle_connections()
RETURNS TABLE(terminated_connections bigint, termination_reason text) AS $$
DECLARE
    terminated_count INTEGER;
BEGIN
    -- Terminate connections idle for more than 1 hour (excluding current connection)
    PERFORM pg_terminate_backend(pid)
    FROM pg_stat_activity
    WHERE state = 'idle'
        AND query_start < now() - interval '1 hour'
        AND pid != pg_backend_pid()
        AND datname = current_database();

    GET DIAGNOSTICS terminated_count = ROW_COUNT;

    RETURN QUERY
    SELECT terminated_count::bigint, 'idle_timeout_exceeded'::text;
END;
$$ LANGUAGE plpgsql;

-- Function to handle connection overflow
CREATE OR REPLACE FUNCTION handle_connection_overflow()
RETURNS TABLE(action_taken text, affected_connections bigint) AS $$
DECLARE
    total_conn INTEGER;
    max_conn INTEGER;
    overflow_count INTEGER;
BEGIN
    -- Get current connection count
    SELECT count(*) INTO total_conn
    FROM pg_stat_activity
    WHERE datname = current_database();

    -- Get max connections setting
    SELECT current_setting('max_connections')::integer INTO max_conn;

    -- Check if we're approaching the limit
    IF total_conn > (max_conn * 0.9) THEN
        -- Terminate oldest idle connections
        PERFORM pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE state = 'idle'
            AND pid != pg_backend_pid()
            AND datname = current_database()
        ORDER BY query_start
        LIMIT total_conn - (max_conn * 0.8);

        GET DIAGNOSTICS overflow_count = ROW_COUNT;

        RETURN QUERY
        SELECT 'terminated_idle_connections'::text, overflow_count::bigint;
    ELSE
        RETURN QUERY
        SELECT 'no_action_needed'::text, 0::bigint;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 6. MONITORING VIEWS FOR CONNECTION POOLING
-- =====================================================

-- Connection pool dashboard view
CREATE OR REPLACE VIEW connection_pool_dashboard AS
SELECT
    p.*,
    CASE
        WHEN p.active_connections > 150 THEN 'OVERLOADED'
        WHEN p.active_connections > 100 THEN 'HIGH_USAGE'
        WHEN p.active_connections > 50 THEN 'MODERATE_USAGE'
        ELSE 'LOW_USAGE'
    END as pool_status,
    ROUND((p.active_connections::float / p.total_connections) * 100, 2) as utilization_percent
FROM (
    SELECT
        DATE_TRUNC('minute', created_at) as time_bucket,
        pool_type,
        AVG(total_connections) as total_connections,
        AVG(active_connections) as active_connections,
        AVG(idle_connections) as idle_connections,
        AVG(cache_hit_ratio) as cache_hit_ratio,
        AVG(wait_time_ms) as avg_wait_time_ms
    FROM pool_performance_metrics
    WHERE created_at > NOW() - INTERVAL '24 hours'
    GROUP BY DATE_TRUNC('minute', created_at), pool_type
) p
ORDER BY time_bucket DESC;

-- Real-time connection monitoring view
CREATE OR REPLACE VIEW real_time_connections AS
SELECT
    pid,
    usename as username,
    application_name,
    client_addr as client_address,
    state,
    CASE
        WHEN state = 'active' THEN EXTRACT(EPOCH FROM (now() - query_start))
        ELSE NULL
    END as query_duration_seconds,
    wait_event_type,
    wait_event,
    query_start,
    backend_start
FROM pg_stat_activity
WHERE datname = current_database()
    AND pid != pg_backend_pid()
ORDER BY query_start DESC NULLS LAST;

-- =====================================================
-- 7. SCHEDULED MAINTENANCE FUNCTIONS
-- =====================================================

-- Create scheduled job to monitor connections (requires pg_cron extension)
-- SELECT cron.schedule('monitor-connections', '*/5 * * * *', 'SELECT log_connection_pool_stats();');
-- SELECT cron.schedule('cleanup-connections', '0 * * * *', 'SELECT * FROM cleanup_idle_connections();');

-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION log_connection_pool_stats() TO PUBLIC;
GRANT EXECUTE ON FUNCTION get_detailed_connection_stats() TO PUBLIC;
GRANT EXECUTE ON FUNCTION find_connection_issues() TO PUBLIC;
GRANT EXECUTE ON FUNCTION record_pool_metrics() TO PUBLIC;
GRANT EXECUTE ON FUNCTION cleanup_idle_connections() TO PUBLIC;
GRANT EXECUTE ON FUNCTION handle_connection_overflow() TO PUBLIC;

-- Log connection pooling setup completion
INSERT INTO system_metrics (metric_name, metric_value, metric_unit, metadata)
VALUES ('database_connection_pooling_configured', 1, 'count',
        '{"timestamp": "' || NOW() || '", "phase": "week5-6_phase2"}');

\echo 'Database connection pooling optimization completed successfully!'
\echo 'Connection pooling features enabled:'
\echo '- Connection monitoring and statistics'
\echo '- PgBouncer configuration templates'
\echo '- Connection issue detection'
\echo '- Performance metrics tracking'
\echo '- Automatic connection management'
\echo '- Real-time monitoring views'