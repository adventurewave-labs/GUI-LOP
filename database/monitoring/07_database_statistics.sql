-- =====================================================
-- GUI-LOP Database Performance Optimization
-- Week 5-6 Phase 2: Database Statistics Collection and Analysis
-- =====================================================

-- =====================================================
-- 1. EXTENDED STATISTICS AND pg_stat_statements SETUP
-- =====================================================

-- Ensure pg_stat_statements is properly configured
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements') THEN
        CREATE EXTENSION pg_stat_statements;
    END IF;
END $$;

-- Reset pg_stat_statements to start fresh collection
SELECT pg_stat_statements_reset();

-- Create enhanced statistics collection tables
CREATE TABLE IF NOT EXISTS database_statistics_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    collection_timestamp TIMESTAMPTZ DEFAULT NOW(),
    database_name VARCHAR(64) NOT NULL,
    total_connections INTEGER NOT NULL,
    active_connections INTEGER NOT NULL,
    idle_connections INTEGER NOT NULL,
    total_transactions BIGINT NOT NULL,
    committed_transactions BIGINT NOT NULL,
    rolled_back_transactions BIGINT NOT NULL,
    blocks_read BIGINT NOT NULL,
    blocks_hit BIGINT NOT NULL,
    cache_hit_ratio DECIMAL(5,2) NOT NULL,
    tuples_returned BIGINT NOT NULL,
    tuples_fetched BIGINT NOT NULL,
    tuples_inserted BIGINT NOT NULL,
    tuples_updated BIGINT NOT NULL,
    tuples_deleted BIGINT NOT NULL,
    database_size_mb NUMERIC NOT NULL,
    temp_files INTEGER NOT NULL,
    temp_bytes BIGINT NOT NULL,
    deadlocks INTEGER NOT NULL,
    conflicts INTEGER NOT NULL,
    metadata JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_db_stats_timestamp ON database_statistics_log (collection_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_db_stats_db_name ON database_statistics_log (database_name, collection_timestamp DESC);

-- Create table-specific statistics log
CREATE TABLE IF NOT EXISTS table_statistics_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    collection_timestamp TIMESTAMPTZ DEFAULT NOW(),
    schema_name VARCHAR(64) NOT NULL,
    table_name VARCHAR(64) NOT NULL,
    total_seq_scan BIGINT NOT NULL,
    total_idx_scan BIGINT NOT NULL,
    total_tup_returned BIGINT NOT NULL,
    total_tup_fetched BIGINT NOT NULL,
    total_tup_inserted BIGINT NOT NULL,
    total_tup_updated BIGINT NOT NULL,
    total_tup_deleted BIGINT NOT NULL,
    total_tup_hot_updated BIGINT NOT NULL,
    n_live_tup INTEGER NOT NULL,
    n_dead_tup INTEGER NOT NULL,
    n_mod_since_analyze INTEGER NOT NULL,
    last_vacuum TIMESTAMPTZ,
    last_autovacuum TIMESTAMPTZ,
    last_analyze TIMESTAMPTZ,
    last_autoanalyze TIMESTAMPTZ,
    vacuum_count INTEGER NOT NULL,
    autovacuum_count INTEGER NOT NULL,
    analyze_count INTEGER NOT NULL,
    autoanalyze_count INTEGER NOT NULL,
    table_size_mb NUMERIC NOT NULL,
    index_size_mb NUMERIC NOT NULL,
    total_size_mb NUMERIC NOT NULL,
    metadata JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_table_stats_timestamp ON table_statistics_log (collection_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_table_stats_table ON table_statistics_log (schema_name, table_name, collection_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_table_stats_size ON table_statistics_log (total_size_mb DESC);

-- Create index-specific statistics log
CREATE TABLE IF NOT EXISTS index_statistics_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    collection_timestamp TIMESTAMPTZ DEFAULT NOW(),
    schema_name VARCHAR(64) NOT NULL,
    table_name VARCHAR(64) NOT NULL,
    index_name VARCHAR(64) NOT NULL,
    idx_scan BIGINT NOT NULL,
    idx_tup_read BIGINT NOT NULL,
    idx_tup_fetch BIGINT NOT NULL,
    index_size_mb NUMERIC NOT NULL,
    is_unique BOOLEAN NOT NULL,
    is_primary BOOLEAN NOT NULL,
    index_type VARCHAR(50) NOT NULL,
    columns_count INTEGER NOT NULL,
    metadata JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_index_stats_timestamp ON index_statistics_log (collection_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_index_stats_index ON index_statistics_log (schema_name, table_name, index_name, collection_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_index_stats_usage ON index_statistics_log (idx_scan DESC);

-- =====================================================
-- 2. STATISTICS COLLECTION FUNCTIONS
-- =====================================================

-- Function to collect comprehensive database statistics
CREATE OR REPLACE FUNCTION collect_database_statistics()
RETURNS void AS $$
DECLARE
    db_stats RECORD;
    collection_time TIMESTAMPTZ := NOW();
BEGIN
    -- Collect database-level statistics
    INSERT INTO database_statistics_log (
        database_name,
        total_connections,
        active_connections,
        idle_connections,
        total_transactions,
        committed_transactions,
        rolled_back_transactions,
        blocks_read,
        blocks_hit,
        cache_hit_ratio,
        tuples_returned,
        tuples_fetched,
        tuples_inserted,
        tuples_updated,
        tuples_deleted,
        database_size_mb,
        temp_files,
        temp_bytes,
        deadlocks,
        conflicts,
        metadata
    )
    SELECT
        d.datname,
        COALESCE(ps.total_connections, 0),
        COALESCE(ps.active_connections, 0),
        COALESCE(ps.idle_connections, 0),
        d.xact_commit + d.xact_rollback as total_transactions,
        d.xact_commit as committed_transactions,
        d.xact_rollback as rolled_back_transactions,
        d.blks_read,
        d.blks_hit,
        CASE
            WHEN d.blks_read > 0 THEN
                ROUND((d.blks_hit::numeric / (d.blks_read + d.blks_hit)) * 100, 2)
            ELSE 100
        END as cache_hit_ratio,
        d.tup_returned,
        d.tup_fetched,
        d.tup_inserted,
        d.tup_updated,
        d.tup_deleted,
        pg_database_size(d.datname) / (1024.0 * 1024.0) as database_size_mb,
        d.temp_files,
        d.temp_bytes,
        d.deadlocks,
        d.conflicts,
        jsonb_build_object(
            'collection_timestamp', collection_time,
            'numbackends', d.numbackends,
            'blk_read_time', d.blk_read_time,
            'blk_write_time', d.blk_write_time,
            'stats_reset', d.stats_reset
        )
    FROM pg_stat_database d
    LEFT JOIN (
        SELECT
            datname,
            count(*) as total_connections,
            count(CASE WHEN state = 'active' THEN 1 END) as active_connections,
            count(CASE WHEN state = 'idle' THEN 1 END) as idle_connections
        FROM pg_stat_activity
        WHERE datname IS NOT NULL
        GROUP BY datname
    ) ps ON d.datname = ps.datname
    WHERE d.datname = current_database();
END;
$$ LANGUAGE plpgsql;

-- Function to collect table-level statistics
CREATE OR REPLACE FUNCTION collect_table_statistics()
RETURNS void AS $$
DECLARE
    table_record RECORD;
BEGIN
    -- Collect statistics for each table
    FOR table_record IN
        SELECT
            schemaname,
            tablename
        FROM pg_tables
        WHERE schemaname NOT IN ('information_schema', 'pg_catalog', 'pg_toast')
            AND tablename NOT LIKE 'pg_%'
    LOOP
        INSERT INTO table_statistics_log (
            schema_name,
            table_name,
            total_seq_scan,
            total_idx_scan,
            total_tup_returned,
            total_tup_fetched,
            total_tup_inserted,
            total_tup_updated,
            total_tup_deleted,
            total_tup_hot_updated,
            n_live_tup,
            n_dead_tup,
            n_mod_since_analyze,
            last_vacuum,
            last_autovacuum,
            last_analyze,
            last_autoanalyze,
            vacuum_count,
            autovacuum_count,
            analyze_count,
            autoanalyze_count,
            table_size_mb,
            index_size_mb,
            total_size_mb,
            metadata
        )
        SELECT
            st.schemaname,
            st.tablename,
            st.seq_scan as total_seq_scan,
            st.idx_scan as total_idx_scan,
            st.seq_tup_read + st.idx_tup_fetch as total_tup_returned,
            st.idx_tup_fetch as total_tup_fetched,
            st.n_tup_ins as total_tup_inserted,
            st.n_tup_upd as total_tup_updated,
            st.n_tup_del as total_tup_deleted,
            st.n_tup_hot_upd as total_tup_hot_updated,
            st.n_live_tup,
            st.n_dead_tup,
            st.n_mod_since_analyze,
            st.last_vacuum,
            st.last_autovacuum,
            st.last_analyze,
            st.last_autoanalyze,
            st.vacuum_count,
            st.autovacuum_count,
            st.analyze_count,
            st.autoanalyze_count,
            pg_total_relation_size(st.schemaname||'.'||st.tablename) / (1024.0 * 1024.0) as total_size_mb,
            pg_indexes_size(st.schemaname||'.'||st.tablename) / (1024.0 * 1024.0) as index_size_mb,
            pg_relation_size(st.schemaname||'.'||st.tablename) / (1024.0 * 1024.0) as table_size_mb,
            jsonb_build_object(
                'collection_timestamp', NOW(),
                'heap_blks_read', st.heap_blks_read,
                'heap_blks_hit', st.heap_blks_hit,
                'idx_blks_read', st.idx_blks_read,
                'idx_blks_hit', st.idx_blks_hit
            )
        FROM pg_stat_user_tables st
        WHERE st.schemaname = table_record.schemaname
            AND st.tablename = table_record.tablename;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Function to collect index-level statistics
CREATE OR REPLACE FUNCTION collect_index_statistics()
RETURNS void AS $$
DECLARE
    index_record RECORD;
BEGIN
    -- Collect statistics for each index
    FOR index_record IN
        SELECT
            schemaname,
            tablename,
            indexname
        FROM pg_stat_user_indexes
        WHERE schemaname NOT IN ('information_schema', 'pg_catalog')
    LOOP
        INSERT INTO index_statistics_log (
            schema_name,
            table_name,
            index_name,
            idx_scan,
            idx_tup_read,
            idx_tup_fetch,
            index_size_mb,
            is_unique,
            is_primary,
            index_type,
            columns_count,
            metadata
        )
        SELECT
            si.schemaname,
            si.tablename,
            si.indexrelname as index_name,
            si.idx_scan,
            si.idx_tup_read,
            si.idx_tup_fetch,
            pg_relation_size(si.indexrelid) / (1024.0 * 1024.0) as index_size_mb,
            i.indisunique as is_unique,
            i.indisprimary as is_primary,
            CASE
                WHEN i.indisunique THEN 'unique'
                WHEN i.indisprimary THEN 'primary'
                WHEN am.amname = 'btree' THEN 'btree'
                WHEN am.amname = 'hash' THEN 'hash'
                WHEN am.amname = 'gist' THEN 'gist'
                WHEN am.amname = 'gin' THEN 'gin'
                WHEN am.amname = 'spgist' THEN 'spgist'
                WHEN am.amname = 'brin' THEN 'brin'
                ELSE 'other'
            END as index_type,
            array_length(i.indkey, 1) as columns_count,
            jsonb_build_object(
                'collection_timestamp', NOW(),
                'indisvalid', i.indisvalid,
                'indcheckxmin', i.indcheckxmin,
                'indisready', i.indisready
            )
        FROM pg_stat_user_indexes si
        JOIN pg_index i ON si.indexrelid = i.indexrelid
        JOIN pg_class c ON i.indexrelid = c.oid
        JOIN pg_am am ON c.relam = am.oid
        WHERE si.schemaname = index_record.schemaname
            AND si.tablename = index_record.tablename
            AND si.indexrelname = index_record.indexname;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Function to collect pg_stat_statements data
CREATE OR REPLACE FUNCTION collect_query_statistics()
RETURNS void AS $$
DECLARE
    query_record RECORD;
BEGIN
    -- Create temporary table for query statistics if it doesn't exist
    CREATE TABLE IF NOT EXISTS query_statistics_extended (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        collection_timestamp TIMESTAMPTZ DEFAULT NOW(),
        query_id BIGINT NOT NULL,
        query_hash VARCHAR(64),
        query_text TEXT NOT NULL,
        calls BIGINT NOT NULL,
        total_time DOUBLE PRECISION NOT NULL,
        mean_time DOUBLE PRECISION NOT NULL,
        min_time DOUBLE PRECISION NOT NULL,
        max_time DOUBLE PRECISION NOT NULL,
        stddev_time DOUBLE PRECISION,
        rows BIGINT NOT NULL,
        shared_blks_hit BIGINT NOT NULL,
        shared_blks_read BIGINT NOT NULL,
        shared_blks_dirtied BIGINT NOT NULL,
        shared_blks_written BIGINT NOT NULL,
        local_blks_hit BIGINT NOT NULL,
        local_blks_read BIGINT NOT NULL,
        local_blks_dirtied BIGINT NOT NULL,
        local_blks_written BIGINT NOT NULL,
        temp_blks_read BIGINT NOT NULL,
        temp_blks_written BIGINT NOT NULL,
        blk_read_time DOUBLE PRECISION NOT NULL,
        blk_write_time DOUBLE PRECISION NOT NULL,
        cpu_user_time DOUBLE PRECISION,
        cpu_system_time DOUBLE PRECISION,
        query_type VARCHAR(50),
        tables_involved TEXT[],
        metadata JSONB DEFAULT '{}'
    );

    -- Collect top 100 queries by total execution time
    FOR query_record IN
        SELECT *
        FROM pg_stat_statements
        ORDER BY total_time DESC
        LIMIT 100
    LOOP
        -- Extract query type and tables involved (simplified parsing)
        INSERT INTO query_statistics_extended (
            query_id,
            query_hash,
            query_text,
            calls,
            total_time,
            mean_time,
            min_time,
            max_time,
            stddev_time,
            rows,
            shared_blks_hit,
            shared_blks_read,
            shared_blks_dirtied,
            shared_blks_written,
            local_blks_hit,
            local_blks_read,
            local_blks_dirtied,
            local_blks_written,
            temp_blks_read,
            temp_blks_written,
            blk_read_time,
            blk_write_time,
            cpu_user_time,
            cpu_system_time,
            query_type,
            tables_involved,
            metadata
        )
        VALUES (
            query_record.queryid,
            md5(query_record.query),
            query_record.query,
            query_record.calls,
            query_record.total_time,
            query_record.mean_time,
            query_record.min_time,
            query_record.max_time,
            query_record.stddev_time,
            query_record.rows,
            query_record.shared_blks_hit,
            query_record.shared_blks_read,
            query_record.shared_blks_dirtied,
            query_record.shared_blks_written,
            query_record.local_blks_hit,
            query_record.local_blks_read,
            query_record.local_blks_dirtied,
            query_record.local_blks_written,
            query_record.temp_blks_read,
            query_record.temp_blks_written,
            query_record.blk_read_time,
            query_record.blk_write_time,
            query_record.cpu_user_time,
            query_record.cpu_system_time,
            UPPER(TRIM(SPLIT_PART(query_record.query, ' ', 1))),
            -- Simple table extraction (would need more sophisticated parsing in production)
            ARRAY[regexp_replace(
                regexp_replace(query_record.query, '.*FROM\s+([a-zA-Z_][a-zA-Z0-9_]*)\s.*', '\1'),
                '.*', '\1'
            )],
            jsonb_build_object(
                'collection_timestamp', NOW(),
                'wal_records', query_record.wal_records,
                'wal_fpi', query_record.wal_fpi,
                'wal_bytes', query_record.wal_bytes
            )
        );
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 3. COMPREHENSIVE STATISTICS COLLECTION
-- =====================================================

-- Function to collect all statistics
CREATE OR REPLACE FUNCTION collect_all_statistics()
RETURNS TABLE(
    collection_type VARCHAR(50),
    records_collected BIGINT,
    collection_time_ms INTEGER,
    status VARCHAR(20)
) AS $$
DECLARE
    start_time TIMESTAMP;
    total_stats_start TIMESTAMP;
BEGIN
    total_stats_start := clock_timestamp();

    -- Collect database statistics
    start_time := clock_timestamp();
    PERFORM collect_database_statistics();
    RETURN QUERY
    SELECT 'database_statistics'::VARCHAR(50), 1::BIGINT,
           EXTRACT(MILLISECONDS FROM (clock_timestamp() - start_time))::INTEGER,
           'success'::VARCHAR(20);

    -- Collect table statistics
    start_time := clock_timestamp();
    PERFORM collect_table_statistics();
    RETURN QUERY
    SELECT 'table_statistics'::VARCHAR(50),
           (SELECT COUNT(*) FROM pg_tables WHERE schemaname NOT IN ('information_schema', 'pg_catalog'))::BIGINT,
           EXTRACT(MILLISECONDS FROM (clock_timestamp() - start_time))::INTEGER,
           'success'::VARCHAR(20);

    -- Collect index statistics
    start_time := clock_timestamp();
    PERFORM collect_index_statistics();
    RETURN QUERY
    SELECT 'index_statistics'::VARCHAR(50),
           (SELECT COUNT(*) FROM pg_indexes WHERE schemaname NOT IN ('information_schema', 'pg_catalog'))::BIGINT,
           EXTRACT(MILLISECONDS FROM (clock_timestamp() - start_time))::INTEGER,
           'success'::VARCHAR(20);

    -- Collect query statistics
    start_time := clock_timestamp();
    PERFORM collect_query_statistics();
    RETURN QUERY
    SELECT 'query_statistics'::VARCHAR(50), 100::BIGINT,
           EXTRACT(MILLISECONDS FROM (clock_timestamp() - start_time))::INTEGER,
           'success'::VARCHAR(20);

    -- Log the complete collection
    INSERT INTO system_metrics (metric_name, metric_value, metric_unit, metadata)
    VALUES ('comprehensive_statistics_collection', 1, 'count',
            jsonb_build_object(
                'timestamp', NOW(),
                'total_collection_time_ms', EXTRACT(MILLISECONDS FROM (clock_timestamp() - total_stats_start))::INTEGER,
                'collection_types', ARRAY['database', 'table', 'index', 'query']
            ));
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 4. STATISTICS ANALYSIS FUNCTIONS
-- =====================================================

-- Function to analyze database performance trends
CREATE OR REPLACE FUNCTION analyze_database_performance_trends(
    time_period INTERVAL DEFAULT INTERVAL '24 hours'
) RETURNS TABLE(
    metric_name VARCHAR(100),
    current_value NUMERIC,
    previous_value NUMERIC,
    change_percentage NUMERIC,
    trend VARCHAR(20),
    status VARCHAR(20)
) AS $$
BEGIN
    RETURN QUERY

    -- Analyze cache hit ratio
    SELECT
        'cache_hit_ratio'::VARCHAR(100),
        dsl_current.cache_hit_ratio,
        COALESCE(dsl_previous.cache_hit_ratio, 0) as previous_value,
        CASE
            WHEN dsl_previous.cache_hit_ratio > 0 THEN
                ROUND(((dsl_current.cache_hit_ratio - dsl_previous.cache_hit_ratio) / dsl_previous.cache_hit_ratio) * 100, 2)
            ELSE 0
        END as change_percentage,
        CASE
            WHEN dsl_current.cache_hit_ratio > dsl_previous.cache_hit_ratio THEN 'improving'
            WHEN dsl_current.cache_hit_ratio < dsl_previous.cache_hit_ratio THEN 'declining'
            ELSE 'stable'
        END as trend,
        CASE
            WHEN dsl_current.cache_hit_ratio >= 95 THEN 'excellent'
            WHEN dsl_current.cache_hit_ratio >= 90 THEN 'good'
            WHEN dsl_current.cache_hit_ratio >= 80 THEN 'fair'
            ELSE 'poor'
        END as status
    FROM (
        SELECT cache_hit_ratio
        FROM database_statistics_log
        WHERE collection_timestamp > NOW() - time_period
        ORDER BY collection_timestamp DESC
        LIMIT 1
    ) dsl_current
    CROSS JOIN (
        SELECT cache_hit_ratio
        FROM database_statistics_log
        WHERE collection_timestamp > NOW() - (time_period * 2)
            AND collection_timestamp <= NOW() - time_period
        ORDER BY collection_timestamp DESC
        LIMIT 1
    ) dsl_previous

    UNION ALL

    -- Analyze active connections
    SELECT
        'active_connections'::VARCHAR(100),
        dsl_current.active_connections::NUMERIC,
        COALESCE(dsl_previous.active_connections, 0)::NUMERIC as previous_value,
        CASE
            WHEN dsl_previous.active_connections > 0 THEN
                ROUND(((dsl_current.active_connections - dsl_previous.active_connections)::numeric / dsl_previous.active_connections) * 100, 2)
            ELSE 0
        END as change_percentage,
        CASE
            WHEN dsl_current.active_connections > dsl_previous.active_connections THEN 'increasing'
            WHEN dsl_current.active_connections < dsl_previous.active_connections THEN 'decreasing'
            ELSE 'stable'
        END as trend,
        CASE
            WHEN dsl_current.active_connections < 50 THEN 'excellent'
            WHEN dsl_current.active_connections < 100 THEN 'good'
            WHEN dsl_current.active_connections < 150 THEN 'fair'
            ELSE 'concerning'
        END as status
    FROM (
        SELECT active_connections
        FROM database_statistics_log
        WHERE collection_timestamp > NOW() - time_period
        ORDER BY collection_timestamp DESC
        LIMIT 1
    ) dsl_current
    CROSS JOIN (
        SELECT active_connections
        FROM database_statistics_log
        WHERE collection_timestamp > NOW() - (time_period * 2)
            AND collection_timestamp <= NOW() - time_period
        ORDER BY collection_timestamp DESC
        LIMIT 1
    ) dsl_previous

    UNION ALL

    -- Analyze transaction throughput
    SELECT
        'transaction_throughput'::VARCHAR(100),
        dsl_current.total_transactions::NUMERIC,
        COALESCE(dsl_previous.total_transactions, 0)::NUMERIC as previous_value,
        CASE
            WHEN dsl_previous.total_transactions > 0 THEN
                ROUND(((dsl_current.total_transactions - dsl_previous.total_transactions)::numeric / dsl_previous.total_transactions) * 100, 2)
            ELSE 0
        END as change_percentage,
        CASE
            WHEN dsl_current.total_transactions > dsl_previous.total_transactions THEN 'increasing'
            WHEN dsl_current.total_transactions < dsl_previous.total_transactions THEN 'decreasing'
            ELSE 'stable'
        END as trend,
        'normal' as status
    FROM (
        SELECT total_transactions
        FROM database_statistics_log
        WHERE collection_timestamp > NOW() - time_period
        ORDER BY collection_timestamp DESC
        LIMIT 1
    ) dsl_current
    CROSS JOIN (
        SELECT total_transactions
        FROM database_statistics_log
        WHERE collection_timestamp > NOW() - (time_period * 2)
            AND collection_timestamp <= NOW() - time_period
        ORDER BY collection_timestamp DESC
        LIMIT 1
    ) dsl_previous;
END;
$$ LANGUAGE plpgsql;

-- Function to identify performance bottlenecks
CREATE OR REPLACE FUNCTION identify_performance_bottlenecks()
RETURNS TABLE(
    bottleneck_type VARCHAR(50),
    severity VARCHAR(20),
    description TEXT,
    affected_object VARCHAR(255),
    impact_score NUMERIC,
    recommendations TEXT[]
) AS $$
BEGIN
    RETURN QUERY

    -- Find tables with high dead tuple ratio
    SELECT
        'high_dead_tuple_ratio'::VARCHAR(50),
        CASE
            WHEN dead_tuple_ratio > 0.2 THEN 'critical'
            WHEN dead_tuple_ratio > 0.1 THEN 'high'
            WHEN dead_tuple_ratio > 0.05 THEN 'medium'
            ELSE 'low'
        END::VARCHAR(20),
        'Table has high percentage of dead tuples, indicating need for vacuum'::TEXT,
        tsl.schema_name || '.' || tsl.table_name as affected_object,
        dead_tuple_ratio * 100 as impact_score,
        ARRAY[
            'Run VACUUM ANALYZE on the table',
            'Consider increasing autovacuum thresholds',
            'Review transaction patterns to reduce bloat'
        ] as recommendations
    FROM (
        SELECT
            schema_name,
            table_name,
            CASE
                WHEN n_live_tup + n_dead_tup > 0 THEN
                    n_dead_tup::numeric / (n_live_tup + n_dead_tup)
                ELSE 0
            END as dead_tuple_ratio
        FROM table_statistics_log
        WHERE collection_timestamp > NOW() - INTERVAL '1 hour'
    ) tsl
    WHERE dead_tuple_ratio > 0.05

    UNION ALL

    -- Find unused indexes
    SELECT
        'unused_indexes'::VARCHAR(50),
        CASE
            WHEN index_size_mb > 100 THEN 'high'
            WHEN index_size_mb > 50 THEN 'medium'
            ELSE 'low'
        END::VARCHAR(20),
        'Index is not being used but consuming storage space'::TEXT,
        isl.schema_name || '.' || isl.table_name || '.' || isl.index_name as affected_object,
        index_size_mb as impact_score,
        ARRAY[
            'Consider dropping unused index',
            'Review if index is needed for rare operations',
            'Monitor index usage before dropping'
        ] as recommendations
    FROM (
        SELECT
            schema_name,
            table_name,
            index_name,
            index_size_mb,
            idx_scan
        FROM index_statistics_log
        WHERE collection_timestamp > NOW() - INTERVAL '1 hour'
    ) isl
    WHERE idx_scan = 0 AND index_size_mb > 10

    UNION ALL

    -- Find slow queries from pg_stat_statements
    SELECT
        'slow_queries'::VARCHAR(50),
        CASE
            WHEN mean_time > 5000 THEN 'critical'
            WHEN mean_time > 1000 THEN 'high'
            WHEN mean_time > 500 THEN 'medium'
            ELSE 'low'
        END::VARCHAR(20),
        'Query has high average execution time'::TEXT,
        'Query ID: ' || query_id::text as affected_object,
        mean_time as impact_score,
        ARRAY[
            'Analyze and optimize query execution plan',
            'Check for missing indexes',
            'Consider query rewriting or indexing'
        ] as recommendations
    FROM pg_stat_statements
    WHERE mean_time > 500
    ORDER BY mean_time DESC
    LIMIT 10;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 5. MONITORING VIEWS
-- =====================================================

-- Database performance dashboard view
CREATE OR REPLACE VIEW database_performance_dashboard AS
SELECT
    DATE_TRUNC('hour', collection_timestamp) as time_bucket,
    AVG(active_connections) as avg_active_connections,
    AVG(total_connections) as avg_total_connections,
    AVG(cache_hit_ratio) as avg_cache_hit_ratio,
    AVG(total_transactions) as avg_total_transactions,
    AVG(committed_transactions) as avg_committed_transactions,
    AVG(rolled_back_transactions) as avg_rolled_back_transactions,
    AVG(database_size_mb) as avg_database_size_mb,
    SUM(blocks_read) as total_blocks_read,
    SUM(blocks_hit) as total_blocks_hit,
    COUNT(*) as data_points
FROM database_statistics_log
WHERE collection_timestamp > NOW() - INTERVAL '24 hours'
GROUP BY DATE_TRUNC('hour', collection_timestamp)
ORDER BY time_bucket DESC;

-- Table performance view
CREATE OR REPLACE VIEW table_performance_summary AS
SELECT
    schema_name,
    table_name,
    AVG(total_seq_scan) as avg_seq_scans,
    AVG(total_idx_scan) as avg_idx_scans,
    AVG(n_live_tup) as avg_live_tuples,
    AVG(n_dead_tup) as avg_dead_tuples,
    AVG(table_size_mb) as avg_table_size_mb,
    AVG(index_size_mb) as avg_index_size_mb,
    AVG(total_size_mb) as avg_total_size_mb,
    MAX(collection_timestamp) as last_collected
FROM table_statistics_log
WHERE collection_timestamp > NOW() - INTERVAL '24 hours'
GROUP BY schema_name, table_name
ORDER BY avg_total_size_mb DESC;

-- Index usage analysis view
CREATE OR REPLACE VIEW index_usage_analysis AS
SELECT
    schema_name,
    table_name,
    index_name,
    SUM(idx_scan) as total_scans,
    AVG(idx_tup_read) as avg_tuples_read,
    AVG(idx_tup_fetch) as avg_tuples_fetched,
    AVG(index_size_mb) as avg_index_size_mb,
    is_unique,
    is_primary,
    index_type,
    CASE
        WHEN SUM(idx_scan) = 0 THEN 'UNUSED'
        WHEN SUM(idx_scan) < 10 THEN 'LOW_USAGE'
        WHEN SUM(idx_scan) < 100 THEN 'MEDIUM_USAGE'
        ELSE 'HIGH_USAGE'
    END as usage_level,
    MAX(collection_timestamp) as last_collected
FROM index_statistics_log
WHERE collection_timestamp > NOW() - INTERVAL '24 hours'
GROUP BY schema_name, table_name, index_name, is_unique, is_primary, index_type
ORDER BY total_scans DESC;

-- Query performance analysis view
CREATE OR REPLACE VIEW query_performance_analysis AS
SELECT
        query_id,
        LEFT(query_text, 100) || '...' as query_preview,
        calls,
        ROUND(total_time, 2) as total_time_seconds,
        ROUND(mean_time, 2) as mean_time_seconds,
        ROUND(min_time, 2) as min_time_seconds,
        ROUND(max_time, 2) as max_time_seconds,
        ROUND(stddev_time, 2) as stddev_time_seconds,
        rows,
        CASE
            WHEN mean_time > 5000 THEN 'CRITICAL'
            WHEN mean_time > 1000 THEN 'HIGH'
            WHEN mean_time > 500 THEN 'MEDIUM'
            ELSE 'LOW'
        END as performance_level
FROM pg_stat_statements
ORDER BY total_time DESC
LIMIT 50;

-- =====================================================
-- 6. STATISTICS MAINTENANCE FUNCTIONS
-- =====================================================

-- Function to clean up old statistics
CREATE OR REPLACE FUNCTION cleanup_old_statistics(
    retention_days INTEGER DEFAULT 30
) RETURNS TABLE(
    table_name TEXT,
    records_deleted BIGINT,
    space_freed_mb NUMERIC
) AS $$
DECLARE
    cleanup_start TIMESTAMP := NOW();
BEGIN
    -- Clean up old database statistics
    DELETE FROM database_statistics_log
    WHERE collection_timestamp < NOW() - INTERVAL '1 day' * retention_days;

    GET DIAGNOSTICS cleanup_start = ROW_COUNT;
    RETURN QUERY
    SELECT 'database_statistics_log'::TEXT,
           cleanup_start::BIGINT,
           pg_total_relation_size('database_statistics_log') / (1024.0 * 1024.0) as space_freed_mb;

    -- Clean up old table statistics
    DELETE FROM table_statistics_log
    WHERE collection_timestamp < NOW() - INTERVAL '1 day' * retention_days;

    GET DIAGNOSTICS cleanup_start = ROW_COUNT;
    RETURN QUERY
    SELECT 'table_statistics_log'::TEXT,
           cleanup_start::BIGINT,
           pg_total_relation_size('table_statistics_log') / (1024.0 * 1024.0) as space_freed_mb;

    -- Clean up old index statistics
    DELETE FROM index_statistics_log
    WHERE collection_timestamp < NOW() - INTERVAL '1 day' * retention_days;

    GET DIAGNOSTICS cleanup_start = ROW_COUNT;
    RETURN QUERY
    SELECT 'index_statistics_log'::TEXT,
           cleanup_start::BIGINT,
           pg_total_relation_size('index_statistics_log') / (1024.0 * 1024.0) as space_freed_mb;

    -- Log cleanup operation
    INSERT INTO system_metrics (metric_name, metric_value, metric_unit, metadata)
    VALUES ('old_statistics_cleanup', 1, 'count',
            jsonb_build_object('timestamp', NOW(), 'retention_days', retention_days));
END;
$$ LANGUAGE plpgsql;

-- Function to optimize statistics collection
CREATE OR REPLACE FUNCTION optimize_statistics_collection()
RETURNS TABLE(
    optimization_action VARCHAR(100),
    status VARCHAR(20),
    execution_time_ms INTEGER
) AS $$
DECLARE
    start_time TIMESTAMP;
BEGIN
    start_time := clock_timestamp();

    -- Update table statistics for large tables
    BEGIN
        EXECUTE 'ANALYZE workflows';
        EXECUTE 'ANALYZE events';
        EXECUTE 'ANALYZE user_sessions';

        RETURN QUERY
        SELECT 'updated_table_statistics'::VARCHAR(100), 'success'::VARCHAR(20),
               EXTRACT(MILLISECONDS FROM (clock_timestamp() - start_time))::INTEGER;
    EXCEPTION WHEN OTHERS THEN
        RETURN QUERY
        SELECT 'updated_table_statistics'::VARCHAR(100), 'failed: ' || SQLERRM,
               EXTRACT(MILLISECONDS FROM (clock_timestamp() - start_time))::INTEGER;
    END;

    -- Reset pg_stat_statements if needed
    start_time := clock_timestamp();
    BEGIN
        SELECT pg_stat_statements_reset();

        RETURN QUERY
        SELECT 'reset_query_statistics'::VARCHAR(100), 'success'::VARCHAR(20),
               EXTRACT(MILLISECONDS FROM (clock_timestamp() - start_time))::INTEGER;
    EXCEPTION WHEN OTHERS THEN
        RETURN QUERY
        SELECT 'reset_query_statistics'::VARCHAR(100), 'failed: ' || SQLERRM,
               EXTRACT(MILLISECONDS FROM (clock_timestamp() - start_time))::INTEGER;
    END;
END;
$$ LANGUAGE plpgsql;

-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION collect_database_statistics() TO PUBLIC;
GRANT EXECUTE ON FUNCTION collect_table_statistics() TO PUBLIC;
GRANT EXECUTE ON FUNCTION collect_index_statistics() TO PUBLIC;
GRANT EXECUTE ON FUNCTION collect_query_statistics() TO PUBLIC;
GRANT EXECUTE ON FUNCTION collect_all_statistics() TO PUBLIC;
GRANT EXECUTE ON FUNCTION analyze_database_performance_trends(INTERVAL) TO PUBLIC;
GRANT EXECUTE ON FUNCTION identify_performance_bottlenecks() TO PUBLIC;
GRANT EXECUTE ON FUNCTION cleanup_old_statistics(INTEGER) TO PUBLIC;
GRANT EXECUTE ON FUNCTION optimize_statistics_collection() TO PUBLIC;

-- Grant access to monitoring views
GRANT SELECT ON database_performance_dashboard TO PUBLIC;
GRANT SELECT ON table_performance_summary TO PUBLIC;
GRANT SELECT ON index_usage_analysis TO PUBLIC;
GRANT SELECT ON query_performance_analysis TO PUBLIC;

-- Set up scheduled statistics collection (requires pg_cron extension)
-- SELECT cron.schedule('collect-statistics', '*/15 * * * *', 'SELECT collect_all_statistics();');
-- SELECT cron.schedule('cleanup-statistics', '0 2 * * *', 'SELECT cleanup_old_statistics(30);');

-- Log database statistics setup completion
INSERT INTO system_metrics (metric_name, metric_value, metric_unit, metadata)
VALUES ('database_statistics_collection_configured', 1, 'count',
        '{"timestamp": "' || NOW() || '", "phase": "week5-6_phase2"}');

\echo 'Database statistics collection and analysis completed successfully!'
\echo 'Statistics collection features enabled:'
\echo '- Comprehensive database statistics logging'
\echo '- Table and index performance tracking'
\echo '- Query performance analysis with pg_stat_statements'
\echo '- Performance trend analysis'
\echo '- Bottleneck identification'
\echo '- Automated statistics maintenance'
\echo '- Performance monitoring dashboards'