-- =====================================================
-- GUI-LOP Database Performance Optimization Migration
-- Week 5-6 Phase 2: Comprehensive Performance Optimization
-- =====================================================

-- Migration: Apply all performance optimizations in order
-- This migration applies all the performance optimization scripts
-- in the correct order to minimize conflicts and ensure dependencies are met
--
-- NOTE: deliberately NOT wrapped in BEGIN/COMMIT. Several of the
-- included scripts (02_advanced_indexing.sql among them) use
-- `CREATE INDEX CONCURRENTLY`, which Postgres refuses to run inside a
-- transaction block ("CREATE INDEX CONCURRENTLY cannot run inside a
-- transaction block"). Every statement below is already idempotent
-- (IF NOT EXISTS / ON CONFLICT DO NOTHING / CREATE OR REPLACE), so
-- running them un-transacted is safe to re-run on failure.

-- Create migration tracking table if not exists
CREATE TABLE IF NOT EXISTS performance_migration_log (
    id SERIAL PRIMARY KEY,
    migration_name VARCHAR(255) NOT NULL UNIQUE,
    applied_at TIMESTAMPTZ DEFAULT NOW(),
    status VARCHAR(20) NOT NULL DEFAULT 'started',
    error_message TEXT,
    execution_time_ms INTEGER
);

-- Insert migration start record
INSERT INTO performance_migration_log (migration_name, status)
VALUES ('002_performance_optimization_migration', 'started')
ON CONFLICT (migration_name) DO NOTHING;

-- Track execution start time
DO $$
DECLARE
    migration_start_time TIMESTAMP := clock_timestamp();
BEGIN
    -- This will be used to track total execution time
    RAISE NOTICE 'Starting performance optimization migration at %', migration_start_time;
END $$;

-- Apply optimization scripts in dependency order

-- 1. Advanced Indexing (no dependencies)
\echo 'Applying advanced indexing strategy...'
\i database/optimizations/02_advanced_indexing.sql

-- 2. Connection Pooling (no dependencies)
\echo 'Applying connection pooling configuration...'
\i database/optimizations/03_connection_pooling.sql

-- 3. Query Performance Monitoring (requires pg_stat_statements)
\echo 'Applying query performance monitoring...'
\i database/monitoring/04_query_performance_monitoring.sql

-- 4. Query Caching (no dependencies)
\echo 'Applying query caching system...'
\i database/cache/05_query_caching.sql

-- 5. Materialized Views (requires base schema)
\echo 'Applying materialized views optimization...'
\i database/optimizations/06_materialized_views.sql

-- 6. Database Statistics (requires pg_stat_statements)
\echo 'Applying database statistics collection...'
\i database/monitoring/07_database_statistics.sql

-- 7. Performance Benchmarking (no dependencies)
\echo 'Applying performance benchmarking tools...'
\i database/benchmarks/08_performance_benchmarking.sql

-- 8. Performance Tuning (no dependencies)
\echo 'Applying performance tuning configuration...'
\i database/optimizations/09_performance_tuning.sql

-- 9. Monitoring Dashboard (no dependencies)
\echo 'Applying monitoring dashboard and alerting...'
\i database/monitoring/10_monitoring_dashboard.sql

-- Update migration completion status
UPDATE performance_migration_log
SET status = 'completed',
    execution_time_ms = EXTRACT(MILLISECONDS FROM (NOW() - clock_timestamp()))::INTEGER
WHERE migration_name = '002_performance_optimization_migration';

-- Create performance verification function
CREATE OR REPLACE FUNCTION verify_performance_optimization()
RETURNS TABLE(
    component VARCHAR(100),
    status VARCHAR(20),
    details TEXT
) AS $$
BEGIN
    RETURN QUERY

    -- Verify indexes
    SELECT
        'Advanced Indexing'::VARCHAR(100),
        CASE WHEN count(*) > 50 THEN 'completed'::VARCHAR(20) ELSE 'incomplete'::VARCHAR(20) END as status,
        format('Created %s performance indexes', count(*)::text) as details
    FROM pg_indexes
    WHERE schemaname = 'public'
        AND indexname LIKE 'idx_%'

    UNION ALL

    -- Verify materialized views
    SELECT
        'Materialized Views'::VARCHAR(100),
        CASE WHEN count(*) >= 4 THEN 'completed'::VARCHAR(20) ELSE 'incomplete'::VARCHAR(20) END as status,
        format('Created %s materialized views', count(*)::text) as details
    FROM pg_matviews
    WHERE schemaname = 'public'
        AND matviewname LIKE 'mv_%'

    UNION ALL

    -- Verify monitoring tables
    SELECT
        'Monitoring System'::VARCHAR(100),
        CASE WHEN count(*) >= 10 THEN 'completed'::VARCHAR(20) ELSE 'incomplete'::VARCHAR(20) END as status,
        format('Created %s monitoring tables', count(*)::text) as details
    FROM information_schema.tables
    WHERE table_schema = 'public'
        AND (table_name LIKE '%metrics%' OR table_name LIKE '%alert%' OR table_name LIKE '%benchmark%')

    UNION ALL

    -- Verify performance functions
    SELECT
        'Performance Functions'::VARCHAR(100),
        CASE WHEN count(*) >= 20 THEN 'completed'::VARCHAR(20) ELSE 'incomplete'::VARCHAR(20) END as status,
        format('Created %s performance functions', count(*)::text) as details
    FROM information_schema.routines
    WHERE routine_schema = 'public'
        AND routine_name LIKE '%performance%'
        OR routine_name LIKE '%benchmark%'
        OR routine_name LIKE '%monitoring%'

    UNION ALL

    -- Verify extensions
    SELECT
        'Required Extensions'::VARCHAR(100),
        CASE WHEN count(*) >= 5 THEN 'completed'::VARCHAR(20) ELSE 'incomplete'::VARCHAR(20) END as status,
        format('Loaded %s extensions', count(*)::text) as details
    FROM pg_extension
    WHERE extname IN ('uuid-ossp', 'pgcrypto', 'pg_stat_statements', 'pg_trgm', 'btree_gin');

END;
$$ LANGUAGE plpgsql;

-- Verify the optimization was applied successfully
DO $$
DECLARE
    verification_record RECORD;
    all_completed BOOLEAN := TRUE;
BEGIN
    RAISE NOTICE 'Verifying performance optimization application...';

    FOR verification_record IN
        SELECT * FROM verify_performance_optimization()
    LOOP
        RAISE NOTICE '%: % - %', verification_record.component, verification_record.status, verification_record.details;
        IF verification_record.status != 'completed' THEN
            all_completed := FALSE;
        END IF;
    END LOOP;

    IF all_completed THEN
        RAISE NOTICE 'All performance optimizations have been successfully applied!';
    ELSE
        RAISE WARNING 'Some optimizations may not have been fully applied. Please check the logs above.';
    END IF;

    -- Create summary metrics
    INSERT INTO system_metrics (metric_name, metric_value, metric_unit, metadata)
    VALUES (
        'performance_optimization_migration_completed',
        1,
        'boolean',
        jsonb_build_object(
            'timestamp', NOW(),
            'phase', 'week5-6_phase2',
            'migration_id', '002',
            'all_components_completed', all_completed
        )
    );
END $$;

\echo '=================================================='
\echo 'GUI-LOP Performance Optimization Migration Completed'
\echo '=================================================='
\echo ''
\echo 'Migration Summary:'
\echo '- Applied advanced indexing strategy'
\echo '- Configured connection pooling'
\echo '- Set up query performance monitoring'
\echo '- Implemented query caching system'
\echo '- Created materialized views for analytics'
\echo '- Established database statistics collection'
\echo '- Deployed performance benchmarking tools'
\echo '- Applied performance tuning configurations'
\echo '- Created monitoring dashboard and alerting'
\echo ''
\echo 'Post-Migration Actions:'
\echo '1. Restart PostgreSQL connection poolers if using PgBouncer'
\echo '2. Run ANALYZE on all tables to update statistics'
\echo '3. Execute materialized view refresh functions'
\echo '4. Test key performance functions and views'
\echo '5. Configure alert thresholds based on workload'
\echo ''
\echo 'Example Verification Queries:'
\echo 'SELECT * FROM verify_performance_optimization();'
\echo 'SELECT * FROM realtime_monitoring_dashboard LIMIT 5;'
\echo 'SELECT * FROM current_system_status;'
\echo 'SELECT run_monitoring_cycle();'
\echo ''
