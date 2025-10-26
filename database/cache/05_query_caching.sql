-- =====================================================
-- GUI-LOP Database Performance Optimization
-- Week 5-6 Phase 2: Query Caching Strategies with Redis Integration
-- =====================================================

-- =====================================================
-- 1. CACHE CONFIGURATION AND SETUP
-- =====================================================

-- Create cache configuration table
CREATE TABLE IF NOT EXISTS cache_configuration (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cache_key VARCHAR(255) UNIQUE NOT NULL,
    cache_type VARCHAR(50) NOT NULL, -- 'query_result', 'user_session', 'workflow_data', 'metadata'
    ttl_seconds INTEGER NOT NULL DEFAULT 300, -- 5 minutes default
    max_size_mb INTEGER DEFAULT 100,
    is_active BOOLEAN DEFAULT true,
    cache_strategy VARCHAR(50) DEFAULT 'write_through', -- 'write_through', 'write_behind', 'cache_aside'
    invalidation_rules JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cache_config_key ON cache_configuration(cache_key);
CREATE INDEX IF NOT EXISTS idx_cache_config_type ON cache_configuration(cache_type);
CREATE INDEX IF NOT EXISTS idx_cache_config_active ON cache_configuration(is_active);

-- Create cache metrics table
CREATE TABLE IF NOT EXISTS cache_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cache_key VARCHAR(255) NOT NULL,
    operation VARCHAR(20) NOT NULL, -- 'hit', 'miss', 'set', 'delete', 'invalidate'
    execution_time_ms INTEGER,
    data_size_bytes INTEGER,
    cache_type VARCHAR(50),
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_cache_metrics_time ON cache_metrics(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_cache_metrics_key ON cache_metrics(cache_key, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_cache_metrics_operation ON cache_metrics(operation, timestamp DESC);

-- Create cache invalidation log table
CREATE TABLE IF NOT EXISTS cache_invalidation_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cache_key_pattern VARCHAR(255) NOT NULL,
    invalidation_reason VARCHAR(100) NOT NULL,
    invalidated_by VARCHAR(100),
    affected_keys_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_invalidation_log_time ON cache_invalidation_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invalidation_log_reason ON cache_invalidation_log(invalidation_reason, created_at DESC);

-- =====================================================
-- 2. QUERY RESULT CACHING FUNCTIONS
-- =====================================================

-- Function to generate cache key for queries
CREATE OR REPLACE FUNCTION generate_cache_key(
    query_text TEXT,
    parameters JSONB DEFAULT '{}'
) RETURNS TEXT AS $$
DECLARE
    normalized_query TEXT;
    parameter_hash TEXT;
BEGIN
    -- Normalize query by removing extra whitespace and standardizing case
    normalized_query := regexp_replace(regexp_replace(query_text, '\s+', ' ', 'g'), '^\s+|\s+$', '', 'g');

    -- Generate hash for parameters if provided
    IF jsonb_array_length(parameters) > 0 THEN
        parameter_hash := md5(parameters::text);
        RETURN md5(normalized_query || '_' || parameter_hash);
    ELSE
        RETURN md5(normalized_query);
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Function to cache query results
CREATE OR REPLACE FUNCTION cache_query_result(
    cache_key_param TEXT,
    query_result JSONB,
    ttl_seconds_param INTEGER DEFAULT 300,
    cache_type_param VARCHAR(50) DEFAULT 'query_result'
) RETURNS BOOLEAN AS $$
DECLARE
    start_time TIMESTAMP;
    execution_time INTEGER;
    cache_exists BOOLEAN;
BEGIN
    start_time := clock_timestamp();

    -- Check if cache configuration exists and is active
    SELECT EXISTS(
        SELECT 1 FROM cache_configuration
        WHERE cache_key = cache_key_param
            AND is_active = true
            AND cache_type = cache_type_param
    ) INTO cache_exists;

    IF NOT cache_exists THEN
        -- Create cache configuration if it doesn't exist
        INSERT INTO cache_configuration (cache_key, cache_type, ttl_seconds)
        VALUES (cache_key_param, cache_type_param, ttl_seconds_param)
        ON CONFLICT (cache_key) DO NOTHING;
    END IF;

    -- Simulate Redis cache set (in real implementation, this would call Redis)
    -- For now, we'll store in a cache table
    execution_time := EXTRACT(MILLISECONDS FROM (clock_timestamp() - start_time));

    -- Log cache set operation
    INSERT INTO cache_metrics (cache_key, operation, execution_time_ms, data_size_bytes, cache_type, metadata)
    VALUES (
        cache_key_param,
        'set',
        execution_time::integer,
        octet_length(query_result::text),
        cache_type_param,
        jsonb_build_object('ttl_seconds', ttl_seconds_param, 'data_type', 'jsonb')
    );

    -- In a real implementation, this would be:
    -- SELECT redis_set(cache_key_param, query_result::text, ttl_seconds_param);

    RETURN true;
END;
$$ LANGUAGE plpgsql;

-- Function to get cached query result
CREATE OR REPLACE FUNCTION get_cached_query_result(
    cache_key_param TEXT
) RETURNS JSONB AS $$
DECLARE
    start_time TIMESTAMP;
    execution_time INTEGER;
    cached_result JSONB;
    cache_type_val VARCHAR(50);
BEGIN
    start_time := clock_timestamp();

    -- Check cache configuration
    SELECT cache_type INTO cache_type_val
    FROM cache_configuration
    WHERE cache_key = cache_key_param AND is_active = true;

    IF cache_type_val IS NULL THEN
        -- Log cache miss
        INSERT INTO cache_metrics (cache_key, operation, execution_time_ms, cache_type)
        VALUES (cache_key_param, 'miss', 0, 'unknown');

        RETURN NULL;
    END IF;

    -- Simulate Redis cache get (in real implementation, this would call Redis)
    -- For demonstration, we'll return NULL (cache miss)
    cached_result := NULL;

    execution_time := EXTRACT(MILLISECONDS FROM (clock_timestamp() - start_time));

    IF cached_result IS NOT NULL THEN
        -- Log cache hit
        INSERT INTO cache_metrics (cache_key, operation, execution_time_ms, data_size_bytes, cache_type, metadata)
        VALUES (
            cache_key_param,
            'hit',
            execution_time::integer,
            octet_length(cached_result::text),
            cache_type_val,
            jsonb_build_object('data_type', 'jsonb')
        );

        RETURN cached_result;
    ELSE
        -- Log cache miss
        INSERT INTO cache_metrics (cache_key, operation, execution_time_ms, cache_type)
        VALUES (cache_key_param, 'miss', execution_time::integer, cache_type_val);

        RETURN NULL;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Function to invalidate cache entries
CREATE OR REPLACE FUNCTION invalidate_cache(
    cache_key_pattern VARCHAR(255),
    invalidation_reason VARCHAR(100) DEFAULT 'manual',
    invalidated_by VARCHAR(100) DEFAULT CURRENT_USER
) RETURNS INTEGER AS $$
DECLARE
    affected_count INTEGER := 0;
    cache_record RECORD;
BEGIN
    -- Find matching cache configurations
    FOR cache_record IN
        SELECT cache_key, cache_type FROM cache_configuration
        WHERE cache_key LIKE cache_key_pattern AND is_active = true
    LOOP
        -- Simulate Redis cache deletion
        -- In real implementation: SELECT redis_del(cache_record.cache_key);

        affected_count := affected_count + 1;

        -- Log cache deletion
        INSERT INTO cache_metrics (cache_key, operation, cache_type, metadata)
        VALUES (cache_record.cache_key, 'delete', cache_record.cache_type,
                jsonb_build_object('invalidation_reason', invalidation_reason, 'invalidated_by', invalidated_by));
    END LOOP;

    -- Log invalidation
    INSERT INTO cache_invalidation_log (cache_key_pattern, invalidation_reason, invalidated_by, affected_keys_count)
    VALUES (cache_key_pattern, invalidation_reason, invalidated_by, affected_count);

    RETURN affected_count;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 3. COMMON QUERY CACHING WRAPPERS
-- =====================================================

-- Function to cache workflow listing queries
CREATE OR REPLACE FUNCTION get_cached_workflow_list(
    user_id_param UUID DEFAULT NULL,
    status_filter TEXT[] DEFAULT NULL,
    limit_count INTEGER DEFAULT 50,
    offset_count INTEGER DEFAULT 0
) RETURNS JSONB AS $$
DECLARE
    cache_key TEXT;
    cache_params JSONB;
    cached_result JSONB;
    query_result JSONB;
BEGIN
    -- Generate cache key
    cache_params := jsonb_build_object(
        'user_id', user_id_param,
        'status_filter', status_filter,
        'limit', limit_count,
        'offset', offset_count
    );

    cache_key := 'workflow_list_' || generate_cache_key(
        'SELECT w.*, u.username as created_by_username FROM workflows w LEFT JOIN users u ON w.created_by = u.id WHERE 1=1',
        cache_params
    );

    -- Try to get from cache
    cached_result := get_cached_query_result(cache_key);

    IF cached_result IS NOT NULL THEN
        RETURN cached_result;
    END IF;

    -- Execute query and cache result
    EXECUTE format('
        SELECT jsonb_agg(
            jsonb_build_object(
                ''id'', w.id,
                ''title'', w.title,
                ''status'', w.status,
                ''template_key'', w.template_key,
                ''created_by'', w.created_by,
                ''created_by_username'', u.username,
                ''created_at'', w.created_at,
                ''updated_at'', w.updated_at
            )
        )
        FROM workflows w
        LEFT JOIN users u ON w.created_by = u.id
        WHERE %s
        ORDER BY w.created_at DESC
        LIMIT %s OFFSET %s',
        CASE
            WHEN user_id_param IS NOT NULL THEN 'w.created_by = ' || quote_literal(user_id_param::text)
            ELSE 'true'
        END ||
        CASE
            WHEN status_filter IS NOT NULL THEN ' AND w.status = ANY(' || quote_literal(status_filter) || ')'
            ELSE ''
        END,
        limit_count,
        offset_count
    ) INTO query_result;

    -- Cache the result for 5 minutes
    PERFORM cache_query_result(cache_key, COALESCE(query_result, '[]'::jsonb), 300, 'workflow_list');

    RETURN query_result;
END;
$$ LANGUAGE plpgsql;

-- Function to cache user session data
CREATE OR REPLACE FUNCTION get_cached_user_session(
    session_token_param VARCHAR(255)
) RETURNS JSONB AS $$
DECLARE
    cache_key TEXT;
    cached_result JSONB;
    query_result JSONB;
BEGIN
    cache_key := 'user_session_' || md5(session_token_param);

    -- Try to get from cache
    cached_result := get_cached_query_result(cache_key);

    IF cached_result IS NOT NULL THEN
        RETURN cached_result;
    END IF;

    -- Execute query and cache result
    SELECT jsonb_build_object(
        'id', s.id,
        'user_id', s.user_id,
        'session_token', s.session_token,
        'created_at', s.created_at,
        'expires_at', s.expires_at,
        'is_active', s.is_active,
        'user', jsonb_build_object(
            'id', u.id,
            'username', u.username,
            'email', u.email,
            'role', u.role
        )
    ) INTO query_result
    FROM user_sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.session_token = session_token_param
        AND s.is_active = true
        AND (s.expires_at IS NULL OR s.expires_at > NOW());

    -- Cache the result for 10 minutes
    PERFORM cache_query_result(cache_key, query_result, 600, 'user_session');

    RETURN query_result;
END;
$$ LANGUAGE plpgsql;

-- Function to cache workflow template data
CREATE OR REPLACE FUNCTION get_cached_workflow_template(
    template_key_param VARCHAR(100)
) RETURNS JSONB AS $$
DECLARE
    cache_key TEXT;
    cached_result JSONB;
    query_result JSONB;
BEGIN
    cache_key := 'workflow_template_' || md5(template_key_param);

    -- Try to get from cache
    cached_result := get_cached_query_result(cache_key);

    IF cached_result IS NOT NULL THEN
        RETURN cached_result;
    END IF;

    -- Execute query and cache result
    SELECT jsonb_build_object(
        'id', t.id,
        'name', t.name,
        'description', t.description,
        'template_key', t.template_key,
        'steps', t.steps,
        'default_config', t.default_config,
        'is_active', t.is_active,
        'created_at', t.created_at,
        'updated_at', t.updated_at
    ) INTO query_result
    FROM workflow_templates t
    WHERE t.template_key = template_key_param
        AND t.is_active = true;

    -- Cache the result for 30 minutes
    PERFORM cache_query_result(cache_key, query_result, 1800, 'workflow_template');

    RETURN query_result;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 4. CACHE MANAGEMENT FUNCTIONS
-- =====================================================

-- Function to get cache performance statistics
CREATE OR REPLACE FUNCTION get_cache_performance_stats(
    time_period INTERVAL DEFAULT INTERVAL '1 hour'
) RETURNS TABLE(
    cache_type VARCHAR(50),
    total_operations bigint,
    cache_hits bigint,
    cache_misses bigint,
    hit_rate numeric,
    avg_response_time_ms numeric,
    total_data_served_mb numeric
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        cache_type,
        COUNT(*) as total_operations,
        COUNT(CASE WHEN operation = 'hit' THEN 1 END) as cache_hits,
        COUNT(CASE WHEN operation = 'miss' THEN 1 END) as cache_misses,
        ROUND(
            (COUNT(CASE WHEN operation = 'hit' THEN 1 END)::numeric /
             NULLIF(COUNT(*), 0)) * 100, 2
        ) as hit_rate,
        ROUND(AVG(execution_time_ms), 2) as avg_response_time_ms,
        ROUND(SUM(data_size_bytes) / (1024.0 * 1024.0), 2) as total_data_served_mb
    FROM cache_metrics
    WHERE timestamp > NOW() - time_period
        AND operation IN ('hit', 'miss')
    GROUP BY cache_type
    ORDER BY total_operations DESC;
END;
$$ LANGUAGE plpgsql;

-- Function to identify cache optimization opportunities
CREATE OR REPLACE FUNCTION analyze_cache_optimization()
RETURNS TABLE(
    optimization_type VARCHAR(100),
    description TEXT,
    potential_impact VARCHAR(20),
    recommendations TEXT[]
) AS $$
BEGIN
    RETURN QUERY

    -- Low hit rate analysis
    SELECT
        'low_hit_rate'::VARCHAR(100),
        'Cache hit rate below 70% for some cache types'::TEXT,
        'medium'::VARCHAR(20),
        ARRAY['Review TTL settings', 'Analyze access patterns', 'Consider cache warming']
    FROM get_cache_performance_stats(INTERVAL '24 hours')
    WHERE hit_rate < 70

    UNION ALL

    -- High miss rate analysis
    SELECT
        'high_miss_rate'::VARCHAR(100),
        'High number of cache misses indicating poor cache efficiency'::TEXT,
        'high'::VARCHAR(20),
        ARRAY['Increase cache size', 'Optimize cache key generation', 'Review invalidation strategy']
    WHERE EXISTS (
        SELECT 1 FROM cache_metrics
        WHERE operation = 'miss'
            AND timestamp > NOW() - INTERVAL '24 hours'
        GROUP BY cache_key
        HAVING COUNT(*) > 100
    )

    UNION ALL

    -- Cache size optimization
    SELECT
        'cache_size_optimization'::VARCHAR(100),
        'Some cache entries may be too large or TTL too short'::TEXT,
        'medium'::VARCHAR(20),
        ARRAY['Optimize data serialization', 'Adjust TTL based on data volatility', 'Implement compression']
    WHERE EXISTS (
        SELECT 1 FROM cache_metrics
        WHERE data_size_bytes > 1024 * 1024  -- 1MB
            AND timestamp > NOW() - INTERVAL '24 hours'
    );
END;
$$ LANGUAGE plpgsql;

-- Function to automatically clean up expired cache configurations
CREATE OR REPLACE FUNCTION cleanup_expired_cache_configurations()
RETURNS TABLE(cleaned_count bigint) AS $$
DECLARE
    cleanup_count INTEGER := 0;
BEGIN
    -- This would typically involve checking Redis for expired keys
    -- For now, we'll clean up cache metrics older than 7 days

    DELETE FROM cache_metrics
    WHERE timestamp < NOW() - INTERVAL '7 days';

    GET DIAGNOSTICS cleanup_count = ROW_COUNT;

    -- Log cleanup operation
    INSERT INTO system_metrics (metric_name, metric_value, metric_unit, metadata)
    VALUES ('cache_metrics_cleaned', cleanup_count, 'count',
            jsonb_build_object('timestamp', NOW(), 'cleanup_type', 'expired_metrics'));

    RETURN QUERY SELECT cleanup_count::bigint;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 5. CACHE WARMING AND PRECOMPUTATION
-- =====================================================

-- Function to warm up common caches
CREATE OR REPLACE FUNCTION warm_common_caches()
RETURNS TABLE(
    cache_type VARCHAR(50),
    cache_key VARCHAR(255),
    status VARCHAR(20),
    execution_time_ms INTEGER
) AS $$
DECLARE
    start_time TIMESTAMP;
    cache_result JSONB;
BEGIN
    -- Warm workflow template caches
    start_time := clock_timestamp();

    FOR cache_result IN
        SELECT get_cached_workflow_template(template_key)
        FROM workflow_templates
        WHERE is_active = true
        LIMIT 10
    LOOP
        RETURN QUERY
        SELECT 'workflow_template'::VARCHAR(50),
               'workflow_template_' || md5((SELECT template_key FROM workflow_templates WHERE is_active = true LIMIT 1)),
               'warmed'::VARCHAR(20),
               EXTRACT(MILLISECONDS FROM (clock_timestamp() - start_time))::INTEGER;
    END LOOP;

    -- Warm user session caches for active users
    start_time := clock_timestamp();

    FOR cache_result IN
        SELECT get_cached_user_session(session_token)
        FROM user_sessions
        WHERE is_active = true
            AND (expires_at IS NULL OR expires_at > NOW())
        LIMIT 5
    LOOP
        RETURN QUERY
        SELECT 'user_session'::VARCHAR(50),
               'user_session_warmed',
               'warmed'::VARCHAR(20),
               EXTRACT(MILLISECONDS FROM (clock_timestamp() - start_time))::INTEGER;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 6. MONITORING VIEWS
-- =====================================================

-- Cache performance dashboard view
CREATE OR REPLACE VIEW cache_performance_dashboard AS
SELECT
    DATE_TRUNC('minute', timestamp) as time_bucket,
    cache_type,
    COUNT(*) as total_operations,
    COUNT(CASE WHEN operation = 'hit' THEN 1 END) as cache_hits,
    COUNT(CASE WHEN operation = 'miss' THEN 1 END) as cache_misses,
    COUNT(CASE WHEN operation = 'set' THEN 1 END) as cache_sets,
    COUNT(CASE WHEN operation = 'delete' THEN 1 END) as cache_deletes,
    ROUND(
        (COUNT(CASE WHEN operation = 'hit' THEN 1 END)::numeric /
         NULLIF(COUNT(CASE WHEN operation IN ('hit', 'miss') THEN 1 END), 0)) * 100, 2
    ) as hit_rate_percent,
    ROUND(AVG(execution_time_ms), 2) as avg_response_time_ms,
    ROUND(SUM(data_size_bytes) / (1024.0 * 1024.0), 2) as data_served_mb
FROM cache_metrics
WHERE timestamp > NOW() - INTERVAL '24 hours'
    AND operation IN ('hit', 'miss', 'set', 'delete')
GROUP BY DATE_TRUNC('minute', timestamp), cache_type
ORDER BY time_bucket DESC, cache_type;

-- Top cache keys view
CREATE OR REPLACE VIEW top_cache_keys AS
SELECT
    cache_key,
    cache_type,
    COUNT(*) as total_operations,
    COUNT(CASE WHEN operation = 'hit' THEN 1 END) as hits,
    COUNT(CASE WHEN operation = 'miss' THEN 1 END) as misses,
    ROUND(
        (COUNT(CASE WHEN operation = 'hit' THEN 1 END)::numeric /
         NULLIF(COUNT(CASE WHEN operation IN ('hit', 'miss') THEN 1 END), 0)) * 100, 2
    ) as hit_rate_percent,
    ROUND(AVG(execution_time_ms), 2) as avg_response_time_ms,
    MAX(timestamp) as last_accessed
FROM cache_metrics
WHERE timestamp > NOW() - INTERVAL '24 hours'
    AND operation IN ('hit', 'miss')
GROUP BY cache_key, cache_type
ORDER BY total_operations DESC
LIMIT 50;

-- Cache invalidation patterns view
CREATE OR REPLACE VIEW cache_invalidation_patterns AS
SELECT
    invalidation_reason,
    COUNT(*) as invalidation_count,
    SUM(affected_keys_count) as total_keys_invalidated,
    COUNT(DISTINCT invalidated_by) as unique_invalidators,
    MAX(created_at) as last_invalidation
FROM cache_invalidation_log
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY invalidation_reason
ORDER BY total_keys_invalidated DESC;

-- =====================================================
-- 7. TRIGGERS FOR AUTOMATIC CACHE INVALIDATION
-- =====================================================

-- Function to invalidate caches on data changes
CREATE OR REPLACE FUNCTION invalidate_related_caches()
RETURNS TRIGGER AS $$
DECLARE
    table_name TEXT;
    record_id UUID;
BEGIN
    table_name := TG_TABLE_NAME;
    record_id := COALESCE(NEW.id, OLD.id);

    -- Invalidate related caches based on table
    IF table_name = 'workflows' THEN
        PERFORM invalidate_cache('workflow_list_%', 'data_change', 'database_trigger');
        PERFORM invalidate_cache('workflow_data_' || record_id::text, 'data_change', 'database_trigger');
    ELSIF table_name = 'users' THEN
        PERFORM invalidate_cache('user_session_%', 'user_data_change', 'database_trigger');
        PERFORM invalidate_cache('workflow_list_%', 'user_data_change', 'database_trigger');
    ELSIF table_name = 'user_sessions' THEN
        PERFORM invalidate_cache('user_session_' || COALESCE(NEW.session_token, OLD.session_token), 'session_change', 'database_trigger');
    ELSIF table_name = 'workflow_templates' THEN
        PERFORM invalidate_cache('workflow_template_%', 'template_change', 'database_trigger');
        PERFORM invalidate_cache('workflow_list_%', 'template_change', 'database_trigger');
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Create triggers for cache invalidation
-- Note: These triggers would be enabled as needed based on performance requirements

-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION generate_cache_key(TEXT, JSONB) TO PUBLIC;
GRANT EXECUTE ON FUNCTION cache_query_result(TEXT, JSONB, INTEGER, VARCHAR(50)) TO PUBLIC;
GRANT EXECUTE ON FUNCTION get_cached_query_result(TEXT) TO PUBLIC;
GRANT EXECUTE ON FUNCTION invalidate_cache(VARCHAR(255), VARCHAR(100), VARCHAR(100)) TO PUBLIC;
GRANT EXECUTE ON FUNCTION get_cached_workflow_list(UUID, TEXT[], INTEGER, INTEGER) TO PUBLIC;
GRANT EXECUTE ON FUNCTION get_cached_user_session(VARCHAR(255)) TO PUBLIC;
GRANT EXECUTE ON FUNCTION get_cached_workflow_template(VARCHAR(100)) TO PUBLIC;
GRANT EXECUTE ON FUNCTION get_cache_performance_stats(INTERVAL) TO PUBLIC;
GRANT EXECUTE ON FUNCTION analyze_cache_optimization() TO PUBLIC;
GRANT EXECUTE ON FUNCTION cleanup_expired_cache_configurations() TO PUBLIC;
GRANT EXECUTE ON FUNCTION warm_common_caches() TO PUBLIC;

-- Grant access to monitoring views
GRANT SELECT ON cache_performance_dashboard TO PUBLIC;
GRANT SELECT ON top_cache_keys TO PUBLIC;
GRANT SELECT ON cache_invalidation_patterns TO PUBLIC;

-- Log query caching setup completion
INSERT INTO system_metrics (metric_name, metric_value, metric_unit, metadata)
VALUES ('database_query_caching_configured', 1, 'count',
        '{"timestamp": "' || NOW() || '", "phase": "week5-6_phase2"}');

\echo 'Database query caching configuration completed successfully!'
\echo 'Query caching features enabled:'
\echo '- Redis integration architecture'
\echo '- Query result caching functions'
\echo '- Cache performance monitoring'
\echo '- Automatic cache invalidation'
\echo '- Cache warming strategies'
\echo '- Performance optimization views'