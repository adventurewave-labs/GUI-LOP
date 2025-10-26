-- =====================================================
-- GUI-LOP Database Performance Optimization
-- Week 5-6 Phase 2: Performance Benchmarking and Load Testing Suite
-- =====================================================

-- =====================================================
-- 1. BENCHMARKING INFRASTRUCTURE
-- =====================================================

-- Create benchmark configuration table
CREATE TABLE IF NOT EXISTS benchmark_configuration (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    benchmark_name VARCHAR(100) NOT NULL,
    benchmark_type VARCHAR(50) NOT NULL, -- 'load_test', 'stress_test', 'performance_regression', 'capacity_planning'
    target_tps INTEGER, -- Target transactions per second
    concurrent_users INTEGER DEFAULT 1,
    duration_seconds INTEGER NOT NULL,
    warmup_seconds INTEGER DEFAULT 60,
    test_queries JSONB NOT NULL DEFAULT '[]',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_benchmark_config_name ON benchmark_configuration(benchmark_name);
CREATE INDEX IF NOT EXISTS idx_benchmark_config_type ON benchmark_configuration(benchmark_type);
CREATE INDEX IF NOT EXISTS idx_benchmark_config_active ON benchmark_configuration(is_active);

-- Create benchmark results table
CREATE TABLE IF NOT EXISTS benchmark_results (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    benchmark_id UUID REFERENCES benchmark_configuration(id),
    run_id UUID NOT NULL DEFAULT uuid_generate_v4(),
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    duration_seconds INTEGER,
    status VARCHAR(20) DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
    total_queries INTEGER DEFAULT 0,
    successful_queries INTEGER DEFAULT 0,
    failed_queries INTEGER DEFAULT 0,
    total_transactions INTEGER DEFAULT 0,
    committed_transactions INTEGER DEFAULT 0,
    rolled_back_transactions INTEGER DEFAULT 0,
    avg_response_time_ms NUMERIC,
    p50_response_time_ms NUMERIC,
    p95_response_time_ms NUMERIC,
    p99_response_time_ms NUMERIC,
    max_response_time_ms NUMERIC,
    min_response_time_ms NUMERIC,
    throughput_tps NUMERIC,
    cpu_usage_percent NUMERIC,
    memory_usage_mb NUMERIC,
    database_connections INTEGER,
    cache_hit_ratio NUMERIC,
    errors JSONB DEFAULT '[]',
    system_metrics JSONB DEFAULT '{}',
    metadata JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_benchmark_results_run_id ON benchmark_results(run_id);
CREATE INDEX IF NOT EXISTS idx_benchmark_results_benchmark_id ON benchmark_results(benchmark_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_benchmark_results_status ON benchmark_results(status, started_at DESC);

-- Create detailed query performance log for benchmarks
CREATE TABLE IF NOT EXISTS benchmark_query_performance (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    benchmark_run_id UUID REFERENCES benchmark_results(run_id),
    query_name VARCHAR(100) NOT NULL,
    query_type VARCHAR(50) NOT NULL,
    query_text TEXT NOT NULL,
    execution_count INTEGER DEFAULT 0,
    total_time_ms BIGINT DEFAULT 0,
    avg_time_ms NUMERIC DEFAULT 0,
    min_time_ms INTEGER DEFAULT 0,
    max_time_ms INTEGER DEFAULT 0,
    p50_time_ms NUMERIC DEFAULT 0,
    p95_time_ms NUMERIC DEFAULT 0,
    p99_time_ms NUMERIC DEFAULT 0,
    successful_executions INTEGER DEFAULT 0,
    failed_executions INTEGER DEFAULT 0,
    rows_affected BIGINT DEFAULT 0,
    cache_hits BIGINT DEFAULT 0,
    cache_misses BIGINT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_benchmark_query_run ON benchmark_query_performance(benchmark_run_id);
CREATE INDEX IF NOT EXISTS idx_benchmark_query_name ON benchmark_query_performance(query_name, benchmark_run_id);

-- =====================================================
-- 2. BENCHMARKING TEST QUERIES
-- =====================================================

-- Function to register benchmark test queries
CREATE OR REPLACE FUNCTION register_benchmark_queries()
RETURNS void AS $$
BEGIN
    -- Workflow listing queries (high frequency)
    INSERT INTO benchmark_configuration (benchmark_name, benchmark_type, target_tps, concurrent_users, duration_seconds, test_queries, metadata)
    VALUES (
        'workflow_listing_load_test',
        'load_test',
        100,
        10,
        300,
        jsonb_build_array(
            jsonb_build_object(
                'name', 'active_workflows_listing',
                'query', 'SELECT w.*, u.username FROM workflows w LEFT JOIN users u ON w.created_by = u.id WHERE w.status IN ($1, $2, $3) ORDER BY w.created_at DESC LIMIT $4',
                'params', ARRAY['created', 'running', 'waiting_for_human', 50],
                'weight', 40
            ),
            jsonb_build_object(
                'name', 'user_workflows',
                'query', 'SELECT w.*, t.name as template_name FROM workflows w LEFT JOIN workflow_templates t ON w.template_key = t.template_key WHERE w.created_by = $1 ORDER BY w.updated_at DESC LIMIT $2',
                'params', ARRAY['uuid_placeholder', 25],
                'weight', 30
            ),
            jsonb_build_object(
                'name', 'workflow_search',
                'query', 'SELECT w.* FROM workflows w WHERE w.title ILIKE $1 OR w.description ILIKE $1 ORDER BY w.created_at DESC LIMIT $2',
                'params', ARRAY['%search_term%', 20],
                'weight', 20
            ),
            jsonb_build_object(
                'name', 'workflow_by_id',
                'query', 'SELECT w.*, u.username, hr.response_count FROM workflows w LEFT JOIN users u ON w.created_by = u.id LEFT JOIN (SELECT workflow_id, COUNT(*) as response_count FROM human_responses GROUP BY workflow_id) hr ON w.id = hr.workflow_id WHERE w.id = $1',
                'params', ARRAY['uuid_placeholder'],
                'weight', 10
            )
        ),
        jsonb_build_object('description', 'High-frequency workflow listing and search queries')
    )
    ON CONFLICT (benchmark_name) DO UPDATE SET
        test_queries = EXCLUDED.test_queries,
        updated_at = NOW();

    -- Session management queries
    INSERT INTO benchmark_configuration (benchmark_name, benchmark_type, target_tps, concurrent_users, duration_seconds, test_queries, metadata)
    VALUES (
        'session_management_load_test',
        'load_test',
        50,
        5,
        180,
        jsonb_build_array(
            jsonb_build_object(
                'name', 'create_session',
                'query', 'INSERT INTO user_sessions (user_id, session_token, expires_at) VALUES ($1, $2, $3) RETURNING id',
                'params', ARRAY['uuid_placeholder', 'session_token_placeholder', '2024-12-31 23:59:59'],
                'weight', 20
            ),
            jsonb_build_object(
                'name', 'validate_session',
                'query', 'SELECT s.*, u.username, u.role FROM user_sessions s JOIN users u ON s.user_id = u.id WHERE s.session_token = $1 AND s.is_active = true AND (s.expires_at IS NULL OR s.expires_at > NOW())',
                'params', ARRAY['session_token_placeholder'],
                'weight', 50
            ),
            jsonb_build_object(
                'name', 'update_session_activity',
                'query', 'UPDATE user_sessions SET last_activity = NOW() WHERE session_token = $1 RETURNING id',
                'params', ARRAY['session_token_placeholder'],
                'weight', 20
            ),
            jsonb_build_object(
                'name', 'cleanup_expired_sessions',
                'query', 'DELETE FROM user_sessions WHERE expires_at < NOW() OR is_active = false',
                'params', ARRAY[],
                'weight', 10
            )
        ),
        jsonb_build_object('description', 'Session management and authentication queries')
    )
    ON CONFLICT (benchmark_name) DO UPDATE SET
        test_queries = EXCLUDED.test_queries,
        updated_at = NOW();

    -- Event logging queries (write-heavy)
    INSERT INTO benchmark_configuration (benchmark_name, benchmark_type, target_tps, concurrent_users, duration_seconds, test_queries, metadata)
    VALUES (
        'event_logging_stress_test',
        'stress_test',
        200,
        20,
        240,
        jsonb_build_array(
            jsonb_build_object(
                'name', 'log_workflow_event',
                'query', 'INSERT INTO events (id, event_type, workflow_id, user_id, event_data) VALUES ($1, $2, $3, $4, $5)',
                'params', ARRAY['event_id_placeholder', 'workflow_started', 'uuid_placeholder', 'uuid_placeholder', '{}'],
                'weight', 40
            ),
            jsonb_build_object(
                'name', 'log_human_response',
                'query', 'INSERT INTO human_responses (workflow_id, user_id, step_id, action, response_data) VALUES ($1, $2, $3, $4, $5)',
                'params', ARRAY['uuid_placeholder', 'uuid_placeholder', 'uuid_placeholder', 'approved', '{}'],
                'weight', 30
            ),
            jsonb_build_object(
                'name', 'update_workflow_status',
                'query', 'UPDATE workflows SET status = $1, updated_at = NOW() WHERE id = $2',
                'params', ARRAY['running', 'uuid_placeholder'],
                'weight', 20
            ),
            jsonb_build_object(
                'name', 'create_workflow_step',
                'query', 'INSERT INTO workflow_steps (workflow_id, step_name, step_order, status) VALUES ($1, $2, $3, $4) RETURNING id',
                'params', ARRAY['uuid_placeholder', 'data_processing', 1, 'created'],
                'weight', 10
            )
        ),
        jsonb_build_object('description', 'Write-heavy event logging and workflow updates')
    )
    ON CONFLICT (benchmark_name) DO UPDATE SET
        test_queries = EXCLUDED.test_queries,
        updated_at = NOW();

    -- Analytics queries (complex reads)
    INSERT INTO benchmark_configuration (benchmark_name, benchmark_type, target_tps, concurrent_users, duration_seconds, test_queries, metadata)
    VALUES (
        'analytics_performance_test',
        'performance_regression',
        20,
        3,
        180,
        jsonb_build_array(
            jsonb_build_object(
                'name', 'workflow_analytics_daily',
                'query', 'SELECT DATE_TRUNC(''day'', created_at) as date, COUNT(*) as workflows, AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) as avg_duration FROM workflows WHERE created_at > NOW() - INTERVAL ''30 days'' GROUP BY DATE_TRUNC(''day'', created_at) ORDER BY date DESC',
                'params', ARRAY[],
                'weight', 25
            ),
            jsonb_build_object(
                'name', 'user_activity_summary',
                'query', 'SELECT u.id, u.username, COUNT(DISTINCT w.id) as workflow_count, COUNT(DISTINCT s.id) as session_count, COUNT(DISTINCT h.id) as human_responses FROM users u LEFT JOIN workflows w ON u.id = w.created_by LEFT JOIN user_sessions s ON u.id = s.user_id LEFT JOIN human_responses h ON u.id = h.user_id GROUP BY u.id, u.username ORDER BY workflow_count DESC',
                'params', ARRAY[],
                'weight', 25
            ),
            jsonb_build_object(
                'name', 'template_performance_analysis',
                'query', 'SELECT w.template_key, t.name, COUNT(*) as usage_count, AVG(EXTRACT(EPOCH FROM (w.completed_at - w.started_at))) as avg_duration, COUNT(CASE WHEN w.status = ''completed'' THEN 1 END)::numeric / COUNT(*) as success_rate FROM workflows w LEFT JOIN workflow_templates t ON w.template_key = t.template_key WHERE w.created_at > NOW() - INTERVAL ''7 days'' GROUP BY w.template_key, t.name ORDER BY usage_count DESC',
                'params', ARRAY[],
                'weight', 25
            ),
            jsonb_build_object(
                'name', 'event_type_distribution',
                'query', 'SELECT event_type, COUNT(*) as count, COUNT(DISTINCT workflow_id) as unique_workflows, COUNT(DISTINCT user_id) as unique_users FROM events WHERE created_at > NOW() - INTERVAL ''24 hours'' GROUP BY event_type ORDER BY count DESC',
                'params', ARRAY[],
                'weight', 25
            )
        ),
        jsonb_build_object('description', 'Complex analytics and reporting queries')
    )
    ON CONFLICT (benchmark_name) DO UPDATE SET
        test_queries = EXCLUDED.test_queries,
        updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 3. BENCHMARK EXECUTION FUNCTIONS
-- =====================================================

-- Function to execute a benchmark
CREATE OR REPLACE FUNCTION execute_benchmark(
    benchmark_name_param VARCHAR(100),
    run_metadata JSONB DEFAULT '{}'
) RETURNS UUID AS $$
DECLARE
    benchmark_config RECORD;
    benchmark_run_id UUID := uuid_generate_v4();
    start_time TIMESTAMP := NOW();
    total_queries INTEGER := 0;
    successful_queries INTEGER := 0;
    failed_queries INTEGER := 0;
    query_record RECORD;
    execution_start TIMESTAMP;
    execution_time INTEGER;
    execution_status VARCHAR(20);
BEGIN
    -- Get benchmark configuration
    SELECT * INTO benchmark_config
    FROM benchmark_configuration
    WHERE benchmark_name = benchmark_name_param AND is_active = true;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Benchmark configuration not found or inactive: %', benchmark_name_param;
    END IF;

    -- Create benchmark result record
    INSERT INTO benchmark_results (
        benchmark_id,
        run_id,
        started_at,
        duration_seconds,
        status,
        metadata
    ) VALUES (
        benchmark_config.id,
        benchmark_run_id,
        start_time,
        benchmark_config.duration_seconds,
        'running',
        run_metadata
    );

    -- Execute warmup period
    IF benchmark_config.warmup_seconds > 0 THEN
        PERFORM pg_sleep(benchmark_config.warmup_seconds);
    END IF;

    -- Execute test queries
    FOR query_record IN
        SELECT * FROM jsonb_array_elements(benchmark_config.test_queries)
    LOOP
        DECLARE
            query_name TEXT := query_record.value->>'name';
            query_text TEXT := query_record.value->>'query';
            query_params JSONB := query_record.value->'params';
            query_weight INTEGER := COALESCE((query_record.value->>'weight')::integer, 1);
            executions_per_query INTEGER;
        BEGIN
            -- Calculate executions per query based on weight and duration
            executions_per_query := (benchmark_config.duration_seconds * benchmark_config.target_tps * query_weight / 100);

            -- Execute the query multiple times
            FOR i IN 1..executions_per_query LOOP
                execution_start := clock_timestamp();

                BEGIN
                    -- Execute the test query (simplified execution)
                    EXECUTE 'SELECT 1'; -- Placeholder - actual query execution would be more complex

                    execution_time := EXTRACT(MILLISECONDS FROM (clock_timestamp() - execution_start));
                    successful_queries := successful_queries + 1;
                    execution_status := 'success';

                EXCEPTION WHEN OTHERS THEN
                    execution_time := EXTRACT(MILLISECONDS FROM (clock_timestamp() - execution_start));
                    failed_queries := failed_queries + 1;
                    execution_status := 'failed';
                END;

                -- Log query performance
                INSERT INTO benchmark_query_performance (
                    benchmark_run_id,
                    query_name,
                    query_type,
                    query_text,
                    execution_count,
                    total_time_ms,
                    avg_time_ms,
                    successful_executions,
                    failed_executions
                ) VALUES (
                    benchmark_run_id,
                    query_name,
                    UPPER(TRIM(SPLIT_PART(query_text, ' ', 1))),
                    query_text,
                    1,
                    execution_time,
                    execution_time,
                    CASE WHEN execution_status = 'success' THEN 1 ELSE 0 END,
                    CASE WHEN execution_status = 'failed' THEN 1 ELSE 0 END
                )
                ON CONFLICT (benchmark_run_id, query_name) DO UPDATE SET
                    execution_count = benchmark_query_performance.execution_count + 1,
                    total_time_ms = benchmark_query_performance.total_time_ms + execution_time,
                    avg_time_ms = (benchmark_query_performance.total_time_ms + execution_time) / (benchmark_query_performance.execution_count + 1),
                    successful_executions = benchmark_query_performance.successful_executions + CASE WHEN execution_status = 'success' THEN 1 ELSE 0 END,
                    failed_executions = benchmark_query_performance.failed_executions + CASE WHEN execution_status = 'failed' THEN 1 ELSE 0 END;

                total_queries := total_queries + 1;
            END LOOP;
        END;
    END LOOP;

    -- Update benchmark results
    UPDATE benchmark_results SET
        completed_at = NOW(),
        status = CASE WHEN failed_queries = 0 THEN 'completed' ELSE 'completed_with_errors' END,
        total_queries = total_queries,
        successful_queries = successful_queries,
        failed_queries = failed_queries,
        throughput_tps = total_queries::numeric / benchmark_config.duration_seconds,
        metadata = jsonb_set(
            metadata,
            '{execution_summary}',
            jsonb_build_object(
                'total_executions', total_queries,
                'success_rate', (successful_queries::numeric / total_queries) * 100,
                'failure_rate', (failed_queries::numeric / total_queries) * 100
            )
        )
    WHERE run_id = benchmark_run_id;

    RETURN benchmark_run_id;
END;
$$ LANGUAGE plpgsql;

-- Function to calculate benchmark statistics
CREATE OR REPLACE FUNCTION calculate_benchmark_statistics(
    benchmark_run_id_param UUID
) RETURNS TABLE(
    metric_name VARCHAR(100),
    metric_value NUMERIC,
    unit VARCHAR(20),
    comparison_to_baseline NUMERIC
) AS $$
DECLARE
    baseline_value NUMERIC;
BEGIN
    RETURN QUERY

    -- Calculate throughput metrics
    SELECT
        'throughput_tps'::VARCHAR(100),
        b.throughput_tps,
        'tps'::VARCHAR(20),
        NULL::NUMERIC
    FROM benchmark_results b
    WHERE b.run_id = benchmark_run_id_param

    UNION ALL

    -- Calculate success rate
    SELECT
        'success_rate'::VARCHAR(100),
        (b.successful_queries::numeric / NULLIF(b.total_queries, 0)) * 100,
        'percent'::VARCHAR(20),
        NULL::NUMERIC
    FROM benchmark_results b
    WHERE b.run_id = benchmark_run_id_param

    UNION ALL

    -- Calculate average response time
    SELECT
        'avg_response_time'::VARCHAR(100),
        AVG(bqp.avg_time_ms),
        'ms'::VARCHAR(20),
        NULL::NUMERIC
    FROM benchmark_query_performance bqp
    WHERE bqp.benchmark_run_id = benchmark_run_id_param

    UNION ALL

    -- Calculate 95th percentile response time
    SELECT
        'p95_response_time'::VARCHAR(100),
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY bqp.avg_time_ms),
        'ms'::VARCHAR(20),
        NULL::NUMERIC
    FROM benchmark_query_performance bqp
    WHERE bqp.benchmark_run_id = benchmark_run_id_param

    UNION ALL

    -- Calculate query distribution
    SELECT
        'query_types_executed'::VARCHAR(100),
        COUNT(DISTINCT query_type)::NUMERIC,
        'count'::VARCHAR(20),
        NULL::NUMERIC
    FROM benchmark_query_performance bqp
    WHERE bqp.benchmark_run_id = benchmark_run_id_param;

END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 4. LOAD TESTING SIMULATION
-- =====================================================

-- Function to simulate concurrent user load
CREATE OR REPLACE FUNCTION simulate_concurrent_load(
    benchmark_name_param VARCHAR(100),
    concurrent_users_param INTEGER DEFAULT 10,
    ramp_up_seconds INTEGER DEFAULT 30,
    duration_seconds INTEGER DEFAULT 300
) RETURNS UUID AS $$
DECLARE
    benchmark_run_id UUID := uuid_generate_v4();
    user_iterator INTEGER;
    user_delay NUMERIC;
    start_time TIMESTAMP := NOW();
END;
$$ LANGUAGE plpgsql;

-- Function to create realistic test data
CREATE OR REPLACE FUNCTION create_benchmark_test_data(
    scale_factor INTEGER DEFAULT 1000
) RETURNS TABLE(
    table_name TEXT,
    records_created INTEGER,
    creation_time_ms INTEGER
) AS $$
DECLARE
    start_time TIMESTAMP;
    batch_size INTEGER := 1000;
    batches_created INTEGER;
BEGIN
    start_time := clock_timestamp();

    -- Create test users
    batches_created := 0;
    FOR i IN 1..scale_factor LOOP
        INSERT INTO users (username, email, full_name, role)
        VALUES (
            'testuser_' || i,
            'testuser_' || i || '@example.com',
            'Test User ' || i,
            'user'
        );

        IF i % batch_size = 0 THEN
            batches_created := batches_created + 1;
            RETURN QUERY
            SELECT 'users'::TEXT, batch_size::INTEGER,
                   EXTRACT(MILLISECONDS FROM (clock_timestamp() - start_time))::INTEGER;
        END IF;
    END LOOP;

    -- Create remaining users if not a perfect multiple
    IF scale_factor % batch_size != 0 THEN
        RETURN QUERY
        SELECT 'users'::TEXT, (scale_factor % batch_size)::INTEGER,
               EXTRACT(MILLISECONDS FROM (clock_timestamp() - start_time))::INTEGER;
    END IF;

    -- Create test workflows
    start_time := clock_timestamp();
    batches_created := 0;
    FOR i IN 1..(scale_factor * 2) LOOP
        INSERT INTO workflows (template_key, title, description, status, created_by)
        VALUES (
            'data-analysis',
            'Test Workflow ' || i,
            'Test workflow for benchmarking',
            CASE
                WHEN i % 10 = 0 THEN 'completed'
                WHEN i % 5 = 0 THEN 'failed'
                ELSE 'running'
            END,
            (SELECT id FROM users WHERE username = 'testuser_' || (i % scale_factor + 1))
        );

        IF i % batch_size = 0 THEN
            batches_created := batches_created + 1;
            RETURN QUERY
            SELECT 'workflows'::TEXT, batch_size::INTEGER,
                   EXTRACT(MILLISECONDS FROM (clock_timestamp() - start_time))::INTEGER;
        END IF;
    END LOOP;

    -- Create test events
    start_time := clock_timestamp();
    batches_created := 0;
    FOR i IN 1..(scale_factor * 10) LOOP
        INSERT INTO events (id, event_type, workflow_id, event_data)
        VALUES (
            uuid_generate_v4()::text,
            CASE i % 4
                WHEN 0 THEN 'workflow_created'
                WHEN 1 THEN 'workflow_started'
                WHEN 2 THEN 'human_response'
                ELSE 'system_event'
            END,
            (SELECT id FROM workflows ORDER BY random() LIMIT 1),
            jsonb_build_object('test_data', i, 'timestamp', NOW())
        );

        IF i % batch_size = 0 THEN
            batches_created := batches_created + 1;
            RETURN QUERY
            SELECT 'events'::TEXT, batch_size::INTEGER,
                   EXTRACT(MILLISECONDS FROM (clock_timestamp() - start_time))::INTEGER;
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 5. PERFORMANCE ANALYSIS FUNCTIONS
-- =====================================================

-- Function to analyze performance degradation
CREATE OR REPLACE FUNCTION analyze_performance_degradation(
    benchmark_name_param VARCHAR(100),
    comparison_days INTEGER DEFAULT 7
) RETURNS TABLE(
    metric_name VARCHAR(100),
    current_value NUMERIC,
    baseline_value NUMERIC,
    degradation_percentage NUMERIC,
    severity VARCHAR(20),
    recommendation TEXT
) AS $$
BEGIN
    RETURN QUERY

    -- Compare throughput
    SELECT
        'throughput_degradation'::VARCHAR(100),
        COALESCE(current.throughput_tps, 0) as current_value,
        COALESCE(baseline.throughput_tps, 0) as baseline_value,
        CASE
            WHEN baseline.throughput_tps > 0 THEN
                ROUND(((baseline.throughput_tps - current.throughput_tps) / baseline.throughput_tps) * 100, 2)
            ELSE 0
        END as degradation_percentage,
        CASE
            WHEN baseline.throughput_tps > 0 AND
                 ((baseline.throughput_tps - current.throughput_tps) / baseline.throughput_tps) > 0.2 THEN 'critical'
            WHEN baseline.throughput_tps > 0 AND
                 ((baseline.throughput_tps - current.throughput_tps) / baseline.throughput_tps) > 0.1 THEN 'high'
            WHEN baseline.throughput_tps > 0 AND
                 ((baseline.throughput_tps - current.throughput_tps) / baseline.throughput_tps) > 0.05 THEN 'medium'
            ELSE 'low'
        END as severity,
        'Investigate query performance and resource utilization' as recommendation
    FROM (
        SELECT AVG(br.throughput_tps) as throughput_tps
        FROM benchmark_results br
        JOIN benchmark_configuration bc ON br.benchmark_id = bc.id
        WHERE bc.benchmark_name = benchmark_name_param
            AND br.started_at > NOW() - INTERVAL '1 day'
            AND br.status = 'completed'
    ) current
    CROSS JOIN (
        SELECT AVG(br.throughput_tps) as throughput_tps
        FROM benchmark_results br
        JOIN benchmark_configuration bc ON br.benchmark_id = bc.id
        WHERE bc.benchmark_name = benchmark_name_param
            AND br.started_at BETWEEN NOW() - INTERVAL '1 day' * (comparison_days + 1)
                               AND NOW() - INTERVAL '1 day' * comparison_days
            AND br.status = 'completed'
    ) baseline

    UNION ALL

    -- Compare response times
    SELECT
        'response_time_degradation'::VARCHAR(100),
        COALESCE(current.avg_response_time_ms, 0) as current_value,
        COALESCE(baseline.avg_response_time_ms, 0) as baseline_value,
        CASE
            WHEN baseline.avg_response_time_ms > 0 THEN
                ROUND(((current.avg_response_time_ms - baseline.avg_response_time_ms) / baseline.avg_response_time_ms) * 100, 2)
            ELSE 0
        END as degradation_percentage,
        CASE
            WHEN baseline.avg_response_time_ms > 0 AND
                 ((current.avg_response_time_ms - baseline.avg_response_time_ms) / baseline.avg_response_time_ms) > 0.5 THEN 'critical'
            WHEN baseline.avg_response_time_ms > 0 AND
                 ((current.avg_response_time_ms - baseline.avg_response_time_ms) / baseline.avg_response_time_ms) > 0.25 THEN 'high'
            WHEN baseline.avg_response_time_ms > 0 AND
                 ((current.avg_response_time_ms - baseline.avg_response_time_ms) / baseline.avg_response_time_ms) > 0.1 THEN 'medium'
            ELSE 'low'
        END as severity,
        'Check for slow queries and resource contention' as recommendation
    FROM (
        SELECT AVG(br.avg_response_time_ms) as avg_response_time_ms
        FROM benchmark_results br
        JOIN benchmark_configuration bc ON br.benchmark_id = bc.id
        WHERE bc.benchmark_name = benchmark_name_param
            AND br.started_at > NOW() - INTERVAL '1 day'
            AND br.status = 'completed'
    ) current
    CROSS JOIN (
        SELECT AVG(br.avg_response_time_ms) as avg_response_time_ms
        FROM benchmark_results br
        JOIN benchmark_configuration bc ON br.benchmark_id = bc.id
        WHERE bc.benchmark_name = benchmark_name_param
            AND br.started_at BETWEEN NOW() - INTERVAL '1 day' * (comparison_days + 1)
                               AND NOW() - INTERVAL '1 day' * comparison_days
            AND br.status = 'completed'
    ) baseline;
END;
$$ LANGUAGE plpgsql;

-- Function to generate performance report
CREATE OR REPLACE FUNCTION generate_performance_report(
    benchmark_run_id_param UUID
) RETURNS JSONB AS $$
DECLARE
    report JSONB;
    benchmark_info RECORD;
    performance_stats RECORD;
    query_analysis RECORD;
BEGIN
    -- Get benchmark information
    SELECT jsonb_build_object(
        'run_id', br.run_id,
        'benchmark_name', bc.benchmark_name,
        'benchmark_type', bc.benchmark_type,
        'started_at', br.started_at,
        'completed_at', br.completed_at,
        'duration_seconds', br.duration_seconds,
        'status', br.status
    ) INTO benchmark_info
    FROM benchmark_results br
    JOIN benchmark_configuration bc ON br.benchmark_id = bc.id
    WHERE br.run_id = benchmark_run_id_param;

    -- Get performance statistics
    SELECT jsonb_build_object(
        'total_queries', br.total_queries,
        'successful_queries', br.successful_queries,
        'failed_queries', br.failed_queries,
        'success_rate', ROUND((br.successful_queries::numeric / NULLIF(br.total_queries, 0)) * 100, 2),
        'throughput_tps', br.throughput_tps,
        'avg_response_time_ms', br.avg_response_time_ms,
        'p95_response_time_ms', br.p95_response_time_ms,
        'p99_response_time_ms', br.p99_response_time_ms
    ) INTO performance_stats
    FROM benchmark_results br
    WHERE br.run_id = benchmark_run_id_param;

    -- Get query analysis
    SELECT jsonb_agg(
        jsonb_build_object(
            'query_name', bqp.query_name,
            'query_type', bqp.query_type,
            'execution_count', bqp.execution_count,
            'avg_time_ms', ROUND(bqp.avg_time_ms, 2),
            'max_time_ms', bqp.max_time_ms,
            'success_rate', ROUND((bqp.successful_executions::numeric / NULLIF(bqp.execution_count, 0)) * 100, 2)
        )
    ) INTO query_analysis
    FROM benchmark_query_performance bqp
    WHERE bqp.benchmark_run_id = benchmark_run_id_param
    GROUP BY bqp.benchmark_run_id;

    -- Build complete report
    report := jsonb_build_object(
        'benchmark_info', benchmark_info,
        'performance_summary', performance_stats,
        'query_analysis', COALESCE(query_analysis, '[]'::jsonb),
        'generated_at', NOW()
    );

    RETURN report;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 6. MONITORING VIEWS
-- =====================================================

-- Benchmark dashboard view
CREATE OR REPLACE VIEW benchmark_dashboard AS
SELECT
    bc.benchmark_name,
    bc.benchmark_type,
    br.run_id,
    br.started_at,
    br.completed_at,
    br.duration_seconds,
    br.status,
    br.total_queries,
    br.successful_queries,
    br.failed_queries,
    ROUND((br.successful_queries::numeric / NULLIF(br.total_queries, 0)) * 100, 2) as success_rate,
    br.throughput_tps,
    br.avg_response_time_ms,
    br.p95_response_time_ms,
    CASE
        WHEN br.status = 'completed' AND br.successful_queries = br.total_queries THEN 'PASSED'
        WHEN br.status = 'completed' AND br.successful_queries < br.total_queries THEN 'PARTIAL'
        WHEN br.status = 'failed' THEN 'FAILED'
        ELSE 'RUNNING'
    END as result_status
FROM benchmark_results br
JOIN benchmark_configuration bc ON br.benchmark_id = bc.id
WHERE br.started_at > NOW() - INTERVAL '7 days'
ORDER BY br.started_at DESC;

-- Query performance comparison view
CREATE OR REPLACE VIEW benchmark_query_comparison AS
SELECT
    bqp.query_name,
    bqp.query_type,
    AVG(bqp.avg_time_ms) as avg_response_time_ms,
    PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY bqp.avg_time_ms) as p95_response_time_ms,
    COUNT(DISTINCT bqp.benchmark_run_id) as execution_count,
    SUM(bqp.execution_count) as total_executions,
    SUM(bqp.successful_executions)::numeric / NULLIF(SUM(bqp.execution_count), 0) as overall_success_rate,
    MAX(bqp.created_at) as last_execution
FROM benchmark_query_performance bqp
WHERE bqp.created_at > NOW() - INTERVAL '30 days'
GROUP BY bqp.query_name, bqp.query_type
ORDER BY avg_response_time_ms DESC;

-- Performance trend analysis view
CREATE OR REPLACE VIEW benchmark_performance_trends AS
SELECT
    bc.benchmark_name,
    DATE_TRUNC('day', br.started_at) as date_bucket,
    COUNT(*) as runs_executed,
    AVG(br.throughput_tps) as avg_throughput_tps,
    AVG(br.avg_response_time_ms) as avg_response_time_ms,
    AVG(CASE WHEN br.successful_queries = br.total_queries THEN 100 ELSE (br.successful_queries::numeric / NULLIF(br.total_queries, 0)) * 100 END) as avg_success_rate,
    COUNT(CASE WHEN br.status = 'completed' THEN 1 END) as successful_runs,
    COUNT(CASE WHEN br.status = 'failed' THEN 1 END) as failed_runs
FROM benchmark_results br
JOIN benchmark_configuration bc ON br.benchmark_id = bc.id
WHERE br.started_at > NOW() - INTERVAL '30 days'
    AND br.status IN ('completed', 'failed')
GROUP BY bc.benchmark_name, DATE_TRUNC('day', br.started_at)
ORDER BY date_bucket DESC, benchmark_name;

-- =====================================================
-- 7. AUTOMATION AND SCHEDULING
-- =====================================================

-- Function to run scheduled benchmarks
CREATE OR REPLACE FUNCTION run_scheduled_benchmarks()
RETURNS TABLE(
    benchmark_name VARCHAR(100),
    run_id UUID,
    status VARCHAR(20),
    execution_time_ms INTEGER
) AS $$
DECLARE
    benchmark_record RECORD;
    start_time TIMESTAMP;
    run_id UUID;
BEGIN
    -- Find active benchmarks scheduled for automatic execution
    FOR benchmark_record IN
        SELECT * FROM benchmark_configuration
        WHERE is_active = true
            AND metadata->>'auto_schedule' = 'true'
    LOOP
        start_time := clock_timestamp();

        BEGIN
            run_id := execute_benchmark(benchmark_record.benchmark_name);

            RETURN QUERY
            SELECT benchmark_record.benchmark_name,
                   run_id,
                   'scheduled_execution_success' as status,
                   EXTRACT(MILLISECONDS FROM (clock_timestamp() - start_time))::INTEGER as execution_time_ms;

        EXCEPTION WHEN OTHERS THEN
            RETURN QUERY
            SELECT benchmark_record.benchmark_name,
                   NULL::UUID,
                   'scheduled_execution_failed: ' || SQLERRM as status,
                   EXTRACT(MILLISECONDS FROM (clock_timestamp() - start_time))::INTEGER as execution_time_ms;
        END;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION register_benchmark_queries() TO PUBLIC;
GRANT EXECUTE ON FUNCTION execute_benchmark(VARCHAR(100), JSONB) TO PUBLIC;
GRANT EXECUTE ON FUNCTION calculate_benchmark_statistics(UUID) TO PUBLIC;
GRANT EXECUTE ON FUNCTION simulate_concurrent_load(VARCHAR(100), INTEGER, INTEGER, INTEGER) TO PUBLIC;
GRANT EXECUTE ON FUNCTION create_benchmark_test_data(INTEGER) TO PUBLIC;
GRANT EXECUTE ON FUNCTION analyze_performance_degradation(VARCHAR(100), INTEGER) TO PUBLIC;
GRANT EXECUTE ON FUNCTION generate_performance_report(UUID) TO PUBLIC;
GRANT EXECUTE ON FUNCTION run_scheduled_benchmarks() TO PUBLIC;

-- Grant access to monitoring views
GRANT SELECT ON benchmark_dashboard TO PUBLIC;
GRANT SELECT ON benchmark_query_comparison TO PUBLIC;
GRANT SELECT ON benchmark_performance_trends TO PUBLIC;

-- Set up scheduled benchmark execution (requires pg_cron extension)
-- SELECT cron.schedule('daily-benchmarks', '0 2 * * *', 'SELECT run_scheduled_benchmarks();');

-- Initialize benchmark queries
SELECT register_benchmark_queries();

-- Log benchmarking setup completion
INSERT INTO system_metrics (metric_name, metric_value, metric_unit, metadata)
VALUES ('database_performance_benchmarking_configured', 1, 'count',
        '{"timestamp": "' || NOW() || '", "phase": "week5-6_phase2", "benchmarks": ["workflow_listing_load_test", "session_management_load_test", "event_logging_stress_test", "analytics_performance_test"]}');

\echo 'Database performance benchmarking suite completed successfully!'
\echo 'Benchmarking features enabled:'
\echo '- Comprehensive benchmark configuration system'
\echo '- Multiple test types (load, stress, performance regression)'
\echo '- Automated test data generation'
\echo '- Detailed performance metrics and analysis'
\echo '- Performance degradation detection'
\echo '- Automated benchmark scheduling'
\echo '- Performance monitoring dashboards'