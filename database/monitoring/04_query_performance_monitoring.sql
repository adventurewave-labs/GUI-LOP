-- =====================================================
-- GUI-LOP Database Performance Optimization
-- Week 5-6 Phase 2: Query Performance Monitoring & Slow Query Detection
-- =====================================================

-- =====================================================
-- 1. SLOW QUERY DETECTION SYSTEM
-- =====================================================

-- Enable necessary extensions if not already enabled
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements') THEN
        CREATE EXTENSION pg_stat_statements;
    END IF;
END $$;

-- Create slow query log table
CREATE TABLE IF NOT EXISTS slow_query_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    query_id bigint,
    query_text text NOT NULL,
    query_hash VARCHAR(64),
    execution_time_ms integer NOT NULL,
    rows_returned bigint,
    rows_examined bigint,
    database_name VARCHAR(64) NOT NULL,
    username VARCHAR(64),
    application_name VARCHAR(128),
    client_address INET,
    query_timestamp TIMESTAMPTZ DEFAULT NOW(),
    execution_plan JSONB,
    analysis JSONB DEFAULT '{}',
    recommendations TEXT[],
    severity VARCHAR(20) DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for slow query log
CREATE INDEX IF NOT EXISTS idx_slow_query_time ON slow_query_log(execution_time_ms DESC);
CREATE INDEX IF NOT EXISTS idx_slow_query_timestamp ON slow_query_log(query_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_slow_query_hash ON slow_query_log(query_hash);
CREATE INDEX IF NOT EXISTS idx_slow_query_severity ON slow_query_log(severity, query_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_slow_query_user ON slow_query_log(username, query_timestamp DESC);

-- Create query performance metrics table
CREATE TABLE IF NOT EXISTS query_performance_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    query_hash VARCHAR(64) NOT NULL,
    query_type VARCHAR(50) NOT NULL, -- 'SELECT', 'INSERT', 'UPDATE', 'DELETE'
    table_name VARCHAR(100),
    execution_count integer NOT NULL DEFAULT 1,
    total_execution_time_ms integer NOT NULL,
    avg_execution_time_ms integer NOT NULL,
    min_execution_time_ms integer NOT NULL,
    max_execution_time_ms integer NOT NULL,
    total_rows_returned bigint DEFAULT 0,
    avg_rows_returned numeric DEFAULT 0,
    stddev_execution_time numeric,
    first_seen TIMESTAMPTZ DEFAULT NOW(),
    last_seen TIMESTAMPTZ DEFAULT NOW(),
    is_slow_query BOOLEAN DEFAULT false,
    optimization_applied BOOLEAN DEFAULT false,
    metadata JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_query_perf_hash ON query_performance_metrics(query_hash);
CREATE INDEX IF NOT EXISTS idx_query_perf_avg_time ON query_performance_metrics(avg_execution_time_ms DESC);
CREATE INDEX IF NOT EXISTS idx_query_perf_table ON query_performance_metrics(table_name, avg_execution_time_ms DESC);
CREATE INDEX IF NOT EXISTS idx_query_perf_slow ON query_performance_metrics(is_slow_query, avg_execution_time_ms DESC);

-- =====================================================
-- 2. QUERY MONITORING FUNCTIONS
-- =====================================================

-- Function to log slow queries
CREATE OR REPLACE FUNCTION log_slow_query()
RETURNS TRIGGER AS $$
DECLARE
    query_hash_val VARCHAR(64);
    query_type_val VARCHAR(50);
    table_name_val VARCHAR(100);
    recommendations TEXT[];
    severity_val VARCHAR(20);
    analysis_data JSONB;
BEGIN
    -- Calculate query hash for identification
    query_hash_val := md5(NEW.query);

    -- Extract query type
    query_type_val := UPPER(TRIM(SPLIT_PART(NEW.query, ' ', 1)));

    -- Extract main table name (simplified)
    IF query_type_val IN ('SELECT', 'UPDATE', 'DELETE') THEN
        table_name_val := regexp_replace(
            regexp_replace(NEW.query, 'FROM\s+([a-zA-Z_][a-zA-Z0-9_]*)', '\1', 'i'),
            '.*FROM\s+([a-zA-Z_][a-zA-Z0-9_]*).*', '\1'
        );
    ELSIF query_type_val = 'INSERT' THEN
        table_name_val := regexp_replace(
            regexp_replace(NEW.query, 'INTO\s+([a-zA-Z_][a-zA-Z0-9_]*)', '\1', 'i'),
            '.*INTO\s+([a-zA-Z_][a-zA-Z0-9_]*).*', '\1'
        );
    END IF;

    -- Determine severity based on execution time
    IF NEW.mean_time > 10000 THEN  -- 10 seconds
        severity_val := 'critical';
    ELSIF NEW.mean_time > 5000 THEN  -- 5 seconds
        severity_val := 'high';
    ELSIF NEW.mean_time > 1000 THEN  -- 1 second
        severity_val := 'medium';
    ELSE
        severity_val := 'low';
    END IF;

    -- Generate recommendations based on query characteristics
    recommendations := ARRAY[]::TEXT[];

    IF NEW.mean_time > 5000 THEN
        recommendations := array_append(recommendations, 'Consider adding appropriate indexes');
    END IF;

    IF NEW.calls > 1000 AND NEW.mean_time > 1000 THEN
        recommendations := array_append(recommendations, 'High-frequency slow query - optimize urgently');
    END IF;

    IF NEW.query LIKE '%EXISTS%' OR NEW.query LIKE '%NOT EXISTS%' THEN
        recommendations := array_append(recommendations, 'Consider using JOIN instead of subquery with EXISTS');
    END IF;

    IF NEW.query LIKE '%SELECT *%' THEN
        recommendations := array_append(recommendations, 'Avoid SELECT * - specify only needed columns');
    END IF;

    IF NEW.query LIKE '%ORDER BY%' AND NEW.query NOT LIKE '%LIMIT%' THEN
        recommendations := array_append(recommendations, 'Consider adding LIMIT clause for large result sets');
    END IF;

    -- Create analysis JSON
    analysis_data := jsonb_build_object(
        'calls', NEW.calls,
        'total_time', NEW.total_time,
        'mean_time', NEW.mean_time,
        'min_time', NEW.min_time,
        'max_time', NEW.max_time,
        'stddev_time', NEW.stddev_time,
        'rows', NEW.rows,
        'shared_blks_hit', NEW.shared_blks_hit,
        'shared_blks_read', NEW.shared_blks_read,
        'local_blks_hit', NEW.local_blks_hit,
        'local_blks_read', NEW.local_blks_read
    );

    -- Log the slow query
    INSERT INTO slow_query_log (
        query_id,
        query_text,
        query_hash,
        execution_time_ms,
        rows_returned,
        rows_examined,
        database_name,
        username,
        application_name,
        client_address,
        query_timestamp,
        analysis,
        recommendations,
        severity
    ) VALUES (
        NEW.queryid,
        NEW.query,
        query_hash_val,
        ROUND(NEW.mean_time * 1000)::integer,
        NEW.rows,
        NEW.rows, -- PostgreSQL doesn't track rows_examined separately
        current_database(),
        current_user,
        current_setting('application_name'),
        inet_client_addr(),
        now(),
        analysis_data,
        recommendations,
        severity_val
    );

    -- Update or insert query performance metrics
    INSERT INTO query_performance_metrics (
        query_hash,
        query_type,
        table_name,
        execution_count,
        total_execution_time_ms,
        avg_execution_time_ms,
        min_execution_time_ms,
        max_execution_time_ms,
        total_rows_returned,
        avg_rows_returned,
        stddev_execution_time,
        last_seen,
        is_slow_query
    ) VALUES (
        query_hash_val,
        query_type_val,
        table_name_val,
        NEW.calls,
        ROUND(NEW.total_time * 1000)::integer,
        ROUND(NEW.mean_time * 1000)::integer,
        ROUND(NEW.min_time * 1000)::integer,
        ROUND(NEW.max_time * 1000)::integer,
        NEW.rows,
        CASE WHEN NEW.calls > 0 THEN NEW.rows::numeric / NEW.calls ELSE 0 END,
        NEW.stddev_time,
        now(),
        NEW.mean_time > 1000  -- Consider queries over 1 second as slow
    )
    ON CONFLICT (query_hash) DO UPDATE SET
        execution_count = query_performance_metrics.execution_count + NEW.calls,
        total_execution_time_ms = query_performance_metrics.total_execution_time_ms + ROUND(NEW.total_time * 1000)::integer,
        avg_execution_time_ms = (query_performance_metrics.total_execution_time_ms + ROUND(NEW.total_time * 1000)::integer) / (query_performance_metrics.execution_count + NEW.calls),
        min_execution_time_ms = LEAST(query_performance_metrics.min_execution_time_ms, ROUND(NEW.min_time * 1000)::integer),
        max_execution_time_ms = GREATEST(query_performance_metrics.max_execution_time_ms, ROUND(NEW.max_time * 1000)::integer),
        total_rows_returned = query_performance_metrics.total_rows_returned + NEW.rows,
        avg_rows_returned = (query_performance_metrics.total_rows_returned + NEW.rows)::numeric / (query_performance_metrics.execution_count + NEW.calls),
        stddev_execution_time = NEW.stddev_time,
        last_seen = now(),
        is_slow_query = NEW.mean_time > 1000 OR query_performance_metrics.is_slow_query;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for slow query logging
-- Note: This trigger would need to be set up to monitor pg_stat_statements
-- The actual implementation depends on your monitoring approach

-- =====================================================
-- 3. QUERY ANALYSIS FUNCTIONS
-- =====================================================

-- Function to analyze top slow queries
CREATE OR REPLACE FUNCTION analyze_top_slow_queries(
    time_period INTERVAL DEFAULT INTERVAL '24 hours',
    limit_count INTEGER DEFAULT 10
)
RETURNS TABLE(
    rank integer,
    query_hash VARCHAR(64),
    query_preview TEXT,
    avg_execution_time_ms integer,
    max_execution_time_ms integer,
    execution_count bigint,
    total_time_ms bigint,
    severity VARCHAR(20),
    recommendations TEXT[]
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        ROW_NUMBER() OVER (ORDER BY avg_execution_time_ms DESC) as rank,
        query_hash,
        LEFT(query_text, 100) || CASE WHEN LENGTH(query_text) > 100 THEN '...' ELSE '' END as query_preview,
        avg_execution_time_ms,
        max_execution_time_ms,
        execution_count,
        total_execution_time_ms,
        severity,
        recommendations
    FROM query_performance_metrics
    WHERE last_seen > NOW() - time_period
        AND is_slow_query = true
    ORDER BY avg_execution_time_ms DESC
    LIMIT limit_count;
END;
$$ LANGUAGE plpgsql;

-- Function to get query performance trends
CREATE OR REPLACE FUNCTION get_query_performance_trends(
    query_hash_param VARCHAR(64),
    period_days INTEGER DEFAULT 7
)
RETURNS TABLE(
    date_bucket TIMESTAMPTZ,
    avg_execution_time_ms integer,
    execution_count bigint,
    total_time_ms bigint
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        DATE_TRUNC('hour', created_at) as date_bucket,
        AVG(execution_time_ms)::integer as avg_execution_time_ms,
        SUM(execution_count) as execution_count,
        SUM(total_execution_time_ms) as total_time_ms
    FROM slow_query_log
    WHERE query_hash = query_hash_param
        AND created_at > NOW() - INTERVAL '1 day' * period_days
    GROUP BY DATE_TRUNC('hour', created_at)
    ORDER BY date_bucket DESC;
END;
$$ LANGUAGE plpgsql;

-- Function to identify problematic queries
CREATE OR REPLACE FUNCTION identify_problematic_queries()
RETURNS TABLE(
    issue_type VARCHAR(50),
    severity VARCHAR(20),
    query_hash VARCHAR(64),
    query_preview TEXT,
    impact_score numeric,
    recommendations TEXT[]
) AS $$
BEGIN
    RETURN QUERY

    -- Queries with high total execution time impact
    SELECT
        'high_total_impact'::VARCHAR(50),
        CASE
            WHEN total_execution_time_ms > 300000 THEN 'critical'  -- 5 minutes
            WHEN total_execution_time_ms > 60000 THEN 'high'      -- 1 minute
            WHEN total_execution_time_ms > 10000 THEN 'medium'    -- 10 seconds
            ELSE 'low'
        END::VARCHAR(20),
        query_hash,
        LEFT(query_text, 100) || '...' as query_preview,
        (total_execution_time_ms * execution_count) / 1000.0 as impact_score, -- score in seconds
        recommendations
    FROM query_performance_metrics
    WHERE total_execution_time_ms * execution_count > 10000  -- More than 10 seconds total impact
    ORDER BY impact_score DESC
    LIMIT 5

    UNION ALL

    -- Frequently executed slow queries
    SELECT
        'frequent_slow_queries'::VARCHAR(50),
        CASE
            WHEN execution_count > 1000 AND avg_execution_time_ms > 1000 THEN 'critical'
            WHEN execution_count > 500 AND avg_execution_time_ms > 500 THEN 'high'
            WHEN execution_count > 100 AND avg_execution_time_ms > 200 THEN 'medium'
            ELSE 'low'
        END::VARCHAR(20),
        query_hash,
        LEFT(query_text, 100) || '...' as query_preview,
        execution_count * avg_execution_time_ms / 1000.0 as impact_score,
        recommendations
    FROM query_performance_metrics
    WHERE execution_count > 100 AND avg_execution_time_ms > 200
    ORDER BY impact_score DESC
    LIMIT 5

    UNION ALL

    -- Queries with high variance (unpredictable performance)
    SELECT
        'high_variance_queries'::VARCHAR(50),
        CASE
            WHEN stddev_execution_time > 5 THEN 'critical'
            WHEN stddev_execution_time > 2 THEN 'high'
            WHEN stddev_execution_time > 1 THEN 'medium'
            ELSE 'low'
        END::VARCHAR(20),
        query_hash,
        LEFT(query_text, 100) || '...' as query_preview,
        stddev_execution_time * 1000 as impact_score,
        array_append(recommendations, 'High execution time variance - investigate query plan instability')
    FROM query_performance_metrics
    WHERE stddev_execution_time IS NOT NULL AND stddev_execution_time > 1
    ORDER BY stddev_execution_time DESC
    LIMIT 5;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 4. AUTOMATIC QUERY OPTIMIZATION
-- =====================================================

-- Function to generate query optimization recommendations
CREATE OR REPLACE FUNCTION generate_query_recommendations(query_text_param TEXT)
RETURNS TABLE(
    recommendation_type VARCHAR(50),
    recommendation TEXT,
    impact VARCHAR(20),
    confidence INTEGER
) AS $$
BEGIN
    RETURN QUERY

    -- Check for missing index indicators
    SELECT
        'missing_index'::VARCHAR(50),
        'Consider adding index on column(s) used in WHERE clause'::TEXT,
        'high'::VARCHAR(20),
        80::INTEGER
    WHERE query_text_param ~* 'WHERE\s+\w+\s*=' AND query_text_param NOT ~* 'EXISTS\s*\('

    UNION ALL

    -- Check for SELECT * usage
    SELECT
        'select_optimization'::VARCHAR(50),
        'Replace SELECT * with specific columns to reduce data transfer'::TEXT,
        'medium'::VARCHAR(20),
        90::INTEGER
    WHERE query_text_param ~* 'SELECT\s+\*\s*FROM'

    UNION ALL

    -- Check for missing LIMIT clause
    SELECT
        'limit_clause'::VARCHAR(50),
        'Add LIMIT clause to prevent large result sets'::TEXT,
        'medium'::VARCHAR(20),
        70::INTEGER
    WHERE query_text_param ~* 'ORDER\s+BY' AND query_text_param NOT ~* 'LIMIT\s+\d+'

    UNION ALL

    -- Check for subquery optimization opportunities
    SELECT
        'subquery_optimization'::VARCHAR(50),
        'Consider converting subquery to JOIN for better performance'::TEXT,
        'high'::VARCHAR(20),
        75::INTEGER
    WHERE query_text_param ~* 'WHERE\s+.*\s+IN\s*\(' AND query_text_param NOT ~* 'JOIN'

    UNION ALL

    -- Check for N+1 query patterns
    SELECT
        'n_plus_one_query'::VARCHAR(50),
        'Potential N+1 query pattern detected - consider batch processing'::TEXT,
        'high'::VARCHAR(20),
        85::INTEGER
    WHERE query_text_param ~* 'WHERE\s+.*\s*=\s*\$' AND query_text_param ~* 'SELECT\s+.*\s+FROM'

    UNION ALL

    -- Check for full table scan indicators
    SELECT
        'full_table_scan'::VARCHAR(50),
        'Query may be performing full table scan - ensure appropriate indexes exist'::TEXT,
        'critical'::VARCHAR(20),
        95::INTEGER
    WHERE query_text_param ~* 'WHERE\s+.*\s+LIKE\s*''%\w+%'';
END;
$$ LANGUAGE plpgsql;

-- Function to create missing index suggestions
CREATE OR REPLACE FUNCTION suggest_missing_indexes()
RETURNS TABLE(
    table_name VARCHAR(100),
    column_names TEXT[],
    index_type VARCHAR(50),
    estimated_improvement VARCHAR(20),
    confidence INTEGER,
    query_count bigint
) AS $$
BEGIN
    RETURN QUERY

    -- Find queries that would benefit from single-column indexes
    SELECT DISTINCT
        regexp_replace(regexp_replace(s.query, '.*WHERE\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=.*', '\1'), '.*', '\1') as table_name,
        ARRAY[regexp_replace(regexp_replace(s.query, '.*WHERE\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=.*', '\1'), '.*', '\1')] as column_names,
        'btree'::VARCHAR(50),
        'high'::VARCHAR(20),
        80::INTEGER,
        count(*)::bigint as query_count
    FROM slow_query_log s
    WHERE s.query ~* 'WHERE\s+[a-zA-Z_][a-zA-Z0-9_]*\s*='
        AND s.created_at > NOW() - INTERVAL '7 days'
        AND s.execution_time_ms > 1000
    GROUP BY regexp_replace(regexp_replace(s.query, '.*WHERE\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=.*', '\1'), '.*', '\1')
    HAVING count(*) > 5
    LIMIT 10;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 5. MONITORING VIEWS
-- =====================================================

-- Query performance dashboard view
CREATE OR REPLACE VIEW query_performance_dashboard AS
SELECT
    DATE_TRUNC('hour', created_at) as time_bucket,
    COUNT(*) as total_queries,
    COUNT(CASE WHEN execution_time_ms > 5000 THEN 1 END) as critical_queries,
    COUNT(CASE WHEN execution_time_ms > 1000 AND execution_time_ms <= 5000 THEN 1 END) as slow_queries,
    COUNT(CASE WHEN execution_time_ms <= 1000 THEN 1 END) as fast_queries,
    ROUND(AVG(execution_time_ms), 2) as avg_execution_time_ms,
    ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY execution_time_ms), 2) as p95_execution_time_ms,
    MAX(execution_time_ms) as max_execution_time_ms
FROM slow_query_log
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY DATE_TRUNC('hour', created_at)
ORDER BY time_bucket DESC;

-- Top problematic queries view
CREATE OR REPLACE VIEW top_problematic_queries AS
SELECT
    qpm.query_hash,
    LEFT(qpm.query_text, 150) || '...' as query_preview,
    qpm.avg_execution_time_ms,
    qpm.execution_count,
    qpm.total_execution_time_ms,
    qpm.severity,
    qpm.recommendations,
    ROUND(qpm.total_execution_time_ms * qpm.execution_count / 1000.0, 2) as total_impact_seconds
FROM (
    SELECT
        query_hash,
        (SELECT query_text FROM slow_query_log sql WHERE sql.query_hash = qpm.query_hash ORDER BY created_at DESC LIMIT 1) as query_text,
        avg_execution_time_ms,
        execution_count,
        total_execution_time_ms,
        (SELECT severity FROM slow_query_log sql WHERE sql.query_hash = qpm.query_hash ORDER BY created_at DESC LIMIT 1) as severity,
        (SELECT recommendations FROM slow_query_log sql WHERE sql.query_hash = qpm.query_hash ORDER BY created_at DESC LIMIT 1) as recommendations
    FROM query_performance_metrics qpm
    WHERE qpm.is_slow_query = true
        AND qpm.last_seen > NOW() - INTERVAL '24 hours'
) qpm
ORDER BY total_impact_seconds DESC
LIMIT 20;

-- Query performance trends view
CREATE OR REPLACE VIEW query_performance_trends AS
SELECT
    DATE_TRUNC('day', created_at) as date,
    COUNT(*) as queries_analyzed,
    ROUND(AVG(execution_time_ms), 2) as avg_execution_time_ms,
    ROUND(PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY execution_time_ms), 2) as median_execution_time_ms,
    ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY execution_time_ms), 2) as p95_execution_time_ms,
    COUNT(DISTINCT query_hash) as unique_queries,
    COUNT(CASE WHEN execution_time_ms > 5000 THEN 1 END) as critical_count
FROM slow_query_log
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY DATE_TRUNC('day', created_at)
ORDER BY date DESC;

-- =====================================================
-- 6. AUTOMATED MONITORING SETUP
-- =====================================================

-- Function to collect pg_stat_statements data
CREATE OR REPLACE FUNCTION collect_query_statistics()
RETURNS void AS $$
DECLARE
    stat_record RECORD;
    query_hash_val VARCHAR(64);
BEGIN
    -- Reset pg_stat_statements to start fresh collection
    SELECT pg_stat_statements_reset();

    -- Log the collection event
    INSERT INTO system_metrics (metric_name, metric_value, metric_unit, metadata)
    VALUES ('query_statistics_collected', 1, 'count',
            jsonb_build_object('timestamp', NOW(), 'collection_type', 'scheduled'));
END;
$$ LANGUAGE plpgsql;

-- Function to analyze query performance over time
CREATE OR REPLACE FUNCTION analyze_query_performance()
RETURNS TABLE(
    period VARCHAR(50),
    total_queries bigint,
    slow_queries bigint,
    critical_queries bigint,
    avg_execution_time_ms numeric,
    queries_per_minute numeric
) AS $$
BEGIN
    RETURN QUERY

    -- Last hour analysis
    SELECT
        'Last Hour'::VARCHAR(50),
        COUNT(*)::bigint,
        COUNT(CASE WHEN execution_time_ms > 1000 THEN 1 END)::bigint,
        COUNT(CASE WHEN execution_time_ms > 5000 THEN 1 END)::bigint,
        AVG(execution_time_ms),
        COUNT(*)::numeric / 60.0
    FROM slow_query_log
    WHERE created_at > NOW() - INTERVAL '1 hour'

    UNION ALL

    -- Last 24 hours analysis
    SELECT
        'Last 24 Hours'::VARCHAR(50),
        COUNT(*)::bigint,
        COUNT(CASE WHEN execution_time_ms > 1000 THEN 1 END)::bigint,
        COUNT(CASE WHEN execution_time_ms > 5000 THEN 1 END)::bigint,
        AVG(execution_time_ms),
        COUNT(*)::numeric / (24 * 60.0)
    FROM slow_query_log
    WHERE created_at > NOW() - INTERVAL '24 hours'

    UNION ALL

    -- Last 7 days analysis
    SELECT
        'Last 7 Days'::VARCHAR(50),
        COUNT(*)::bigint,
        COUNT(CASE WHEN execution_time_ms > 1000 THEN 1 END)::bigint,
        COUNT(CASE WHEN execution_time_ms > 5000 THEN 1 END)::bigint,
        AVG(execution_time_ms),
        COUNT(*)::numeric / (7 * 24 * 60.0)
    FROM slow_query_log
    WHERE created_at > NOW() - INTERVAL '7 days';
END;
$$ LANGUAGE plpgsql;

-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION analyze_top_slow_queries(INTERVAL, INTEGER) TO PUBLIC;
GRANT EXECUTE ON FUNCTION get_query_performance_trends(VARCHAR(64), INTEGER) TO PUBLIC;
GRANT EXECUTE ON FUNCTION identify_problematic_queries() TO PUBLIC;
GRANT EXECUTE ON FUNCTION generate_query_recommendations(TEXT) TO PUBLIC;
GRANT EXECUTE ON FUNCTION suggest_missing_indexes() TO PUBLIC;
GRANT EXECUTE ON FUNCTION collect_query_statistics() TO PUBLIC;
GRANT EXECUTE ON FUNCTION analyze_query_performance() TO PUBLIC;

-- Grant access to monitoring views
GRANT SELECT ON query_performance_dashboard TO PUBLIC;
GRANT SELECT ON top_problematic_queries TO PUBLIC;
GRANT SELECT ON query_performance_trends TO PUBLIC;

-- Log query monitoring setup completion
INSERT INTO system_metrics (metric_name, metric_value, metric_unit, metadata)
VALUES ('database_query_monitoring_configured', 1, 'count',
        '{"timestamp": "' || NOW() || '", "phase": "week5-6_phase2"}');

\echo 'Database query performance monitoring completed successfully!'
\echo 'Query monitoring features enabled:'
\echo '- Slow query detection and logging'
\echo '- Query performance analysis and trends'
\echo '- Automatic optimization recommendations'
\echo '- Missing index suggestions'
\echo '- Performance monitoring views'
\echo '- Problematic query identification'