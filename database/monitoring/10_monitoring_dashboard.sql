-- =====================================================
-- GUI-LOP Database Performance Optimization
-- Week 5-6 Phase 2: Database Monitoring Dashboard and Alerting System
-- =====================================================

-- =====================================================
-- 1. MONITORING INFRASTRUCTURE
-- =====================================================

-- Create monitoring metrics storage
CREATE TABLE IF NOT EXISTS monitoring_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    metric_name VARCHAR(100) NOT NULL,
    metric_type VARCHAR(50) NOT NULL, -- 'counter', 'gauge', 'histogram', 'timer'
    metric_value NUMERIC NOT NULL,
    metric_unit VARCHAR(20),
    tags JSONB DEFAULT '{}',
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    collection_source VARCHAR(50) DEFAULT 'database'
);

CREATE INDEX IF NOT EXISTS idx_monitoring_metrics_name_time ON monitoring_metrics(metric_name, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_monitoring_metrics_type_time ON monitoring_metrics(metric_type, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_monitoring_metrics_tags ON monitoring_metrics USING gin(tags);

-- Create alert configuration table
CREATE TABLE IF NOT EXISTS alert_configuration (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    alert_name VARCHAR(100) NOT NULL UNIQUE,
    alert_type VARCHAR(50) NOT NULL, -- 'threshold', 'rate_change', 'pattern_match', 'anomaly'
    metric_name VARCHAR(100) NOT NULL,
    condition_operator VARCHAR(10) NOT NULL, -- '>', '<', '>=', '<=', '=', '!=', 'between'
    threshold_value NUMERIC,
    threshold_value_2 NUMERIC, -- For 'between' operator
    evaluation_window INTERVAL DEFAULT '5 minutes',
    consecutive_breaches INTEGER DEFAULT 1,
    severity VARCHAR(20) CHECK (severity IN ('info', 'warning', 'critical', 'emergency')),
    is_active BOOLEAN DEFAULT true,
    notification_channels JSONB DEFAULT '[]',
    cooldown_period INTERVAL DEFAULT '15 minutes',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_config_active ON alert_configuration(is_active, alert_name);
CREATE INDEX IF NOT EXISTS idx_alert_config_metric ON alert_configuration(metric_name, is_active);

-- Create alert incidents table
CREATE TABLE IF NOT EXISTS alert_incidents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    alert_configuration_id UUID REFERENCES alert_configuration(id),
    incident_id UUID NOT NULL DEFAULT uuid_generate_v4(),
    status VARCHAR(20) DEFAULT 'firing' CHECK (status IN ('firing', 'resolved', 'acknowledged', 'suppressed')),
    severity VARCHAR(20),
    message TEXT NOT NULL,
    metric_value NUMERIC,
    threshold_value NUMERIC,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    acknowledged_at TIMESTAMPTZ,
    acknowledged_by VARCHAR(100),
    duration_seconds INTEGER,
    metadata JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_alert_incidents_status ON alert_incidents(status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_incidents_incident ON alert_incidents(incident_id);
CREATE INDEX IF NOT EXISTS idx_alert_incidents_config ON alert_incidents(alert_configuration_id, started_at DESC);

-- Create dashboard configuration table
CREATE TABLE IF NOT EXISTS dashboard_configuration (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    dashboard_name VARCHAR(100) NOT NULL UNIQUE,
    dashboard_type VARCHAR(50) NOT NULL, -- 'system_overview', 'performance', 'alerts', 'capacity'
    layout_config JSONB NOT NULL DEFAULT '{}',
    widgets JSONB NOT NULL DEFAULT '[]',
    refresh_interval_seconds INTEGER DEFAULT 30,
    is_public BOOLEAN DEFAULT false,
    created_by VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 2. METRIC COLLECTION FUNCTIONS
-- =====================================================

-- Function to collect system health metrics
CREATE OR REPLACE FUNCTION collect_system_health_metrics()
RETURNS void AS $$
DECLARE
    connection_count INTEGER;
    active_connection_count INTEGER;
    cache_hit_ratio NUMERIC;
    database_size_mb NUMERIC;
    replication_lag_seconds NUMERIC;
BEGIN
    -- Collect connection metrics
    SELECT count(*) INTO connection_count
    FROM pg_stat_activity
    WHERE datname = current_database();

    SELECT count(*) INTO active_connection_count
    FROM pg_stat_activity
    WHERE state = 'active' AND datname = current_database();

    -- Collect cache metrics
    SELECT CASE
        WHEN blks_read > 0 THEN
            ROUND((blks_hit::numeric / (blks_read + blks_hit)) * 100, 2)
        ELSE 100
    END INTO cache_hit_ratio
    FROM pg_stat_database
    WHERE datname = current_database();

    -- Collect database size
    SELECT pg_database_size(current_database()) / (1024.0 * 1024.0) INTO database_size_mb;

    -- Store metrics
    INSERT INTO monitoring_metrics (metric_name, metric_type, metric_value, metric_unit, tags)
    VALUES
        ('database.connections.total', 'gauge', connection_count, 'count',
         jsonb_build_object('database', current_database())),
        ('database.connections.active', 'gauge', active_connection_count, 'count',
         jsonb_build_object('database', current_database())),
        ('database.cache.hit_ratio', 'gauge', cache_hit_ratio, 'percent',
         jsonb_build_object('database', current_database())),
        ('database.size.total', 'gauge', database_size_mb, 'megabytes',
         jsonb_build_object('database', current_database())),
        ('database.health.status', 'gauge', CASE WHEN connection_count > 0 THEN 1 ELSE 0 END, 'boolean',
         jsonb_build_object('database', current_database()));
END;
$$ LANGUAGE plpgsql;

-- Function to collect performance metrics
CREATE OR REPLACE FUNCTION collect_performance_metrics()
RETURNS void AS $$
DECLARE
    avg_query_time NUMERIC;
    slow_query_count INTEGER;
    lock_wait_count INTEGER;
    checkpoint_write_time NUMERIC;
    wal_write_bytes NUMERIC;
BEGIN
    -- Collect query performance metrics
    SELECT AVG(mean_time) INTO avg_query_time
    FROM pg_stat_statements
    WHERE calls > 10;

    SELECT COUNT(*) INTO slow_query_count
    FROM pg_stat_statements
    WHERE mean_time > 1000; -- Queries with avg time > 1 second

    -- Collect lock metrics
    SELECT COUNT(*) INTO lock_wait_count
    FROM pg_stat_activity
    WHERE wait_event_type = 'Lock';

    -- Collect WAL metrics
    SELECT blks_written, wal_bytes INTO checkpoint_write_time, wal_write_bytes
    FROM pg_stat_database
    WHERE datname = current_database();

    -- Store performance metrics
    INSERT INTO monitoring_metrics (metric_name, metric_type, metric_value, metric_unit, tags)
    VALUES
        ('performance.query.avg_time', 'gauge', COALESCE(avg_query_time, 0), 'milliseconds',
         jsonb_build_object('database', current_database())),
        ('performance.queries.slow', 'counter', slow_query_count, 'count',
         jsonb_build_object('database', current_database())),
        ('performance.lock_waits', 'gauge', lock_wait_count, 'count',
         jsonb_build_object('database', current_database())),
        ('performance.wal.write_bytes', 'counter', COALESCE(wal_write_bytes, 0), 'bytes',
         jsonb_build_object('database', current_database())),
        ('performance.checkpoint.write_time', 'gauge', COALESCE(checkpoint_write_time, 0), 'milliseconds',
         jsonb_build_object('database', current_database()));
END;
$$ LANGUAGE plpgsql;

-- Function to collect workflow-specific metrics
CREATE OR REPLACE FUNCTION collect_workflow_metrics()
RETURNS void AS $$
DECLARE
    active_workflows INTEGER;
    completed_workflows_today INTEGER;
    avg_workflow_duration NUMERIC;
    human_responses_today INTEGER;
    error_rate NUMERIC;
BEGIN
    -- Collect workflow status metrics
    SELECT COUNT(*) INTO active_workflows
    FROM workflows
    WHERE status IN ('created', 'running', 'waiting_for_human');

    SELECT COUNT(*) INTO completed_workflows_today
    FROM workflows
    WHERE status = 'completed'
        AND DATE(completed_at) = CURRENT_DATE;

    SELECT AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) INTO avg_workflow_duration
    FROM workflows
    WHERE status = 'completed'
        AND completed_at > NOW() - INTERVAL '24 hours';

    SELECT COUNT(*) INTO human_responses_today
    FROM human_responses
    WHERE DATE(created_at) = CURRENT_DATE;

    -- Calculate error rate
    SELECT CASE
        WHEN COUNT(*) > 0 THEN
            (COUNT(CASE WHEN status = 'failed' THEN 1 END)::numeric / COUNT(*)) * 100
        ELSE 0
    END INTO error_rate
    FROM workflows
    WHERE created_at > NOW() - INTERVAL '24 hours';

    -- Store workflow metrics
    INSERT INTO monitoring_metrics (metric_name, metric_type, metric_value, metric_unit, tags)
    VALUES
        ('workflows.active', 'gauge', active_workflows, 'count',
         jsonb_build_object('environment', 'production')),
        ('workflows.completed.daily', 'counter', completed_workflows_today, 'count',
         jsonb_build_object('environment', 'production')),
        ('workflows.duration.avg', 'gauge', COALESCE(avg_workflow_duration, 0), 'seconds',
         jsonb_build_object('environment', 'production')),
        ('workflows.human_responses.daily', 'counter', human_responses_today, 'count',
         jsonb_build_object('environment', 'production')),
        ('workflows.error_rate', 'gauge', error_rate, 'percent',
         jsonb_build_object('environment', 'production'));
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 3. ALERTING FUNCTIONS
-- =====================================================

-- Function to evaluate alert conditions
CREATE OR REPLACE FUNCTION evaluate_alert_conditions()
RETURNS TABLE(
    alert_name VARCHAR(100),
    current_value NUMERIC,
    threshold_value NUMERIC,
    condition_met BOOLEAN,
    severity VARCHAR(20),
    message TEXT
) AS $$
DECLARE
    alert_record RECORD;
    current_metric_value NUMERIC;
    breach_count INTEGER;
BEGIN
    -- Create temporary table for results
    CREATE TEMPORARY TABLE IF NOT EXISTS alert_evaluation_results (
        alert_name VARCHAR(100),
        current_value NUMERIC,
        threshold_value NUMERIC,
        condition_met BOOLEAN,
        severity VARCHAR(20),
        message TEXT
    );

    FOR alert_record IN
        SELECT * FROM alert_configuration
        WHERE is_active = true
    LOOP
        -- Get latest metric value
        SELECT metric_value INTO current_metric_value
        FROM monitoring_metrics
        WHERE metric_name = alert_record.metric_name
            AND timestamp > NOW() - alert_record.evaluation_window
        ORDER BY timestamp DESC
        LIMIT 1;

        IF current_metric_value IS NOT NULL THEN
            -- Evaluate condition
            DECLARE
                condition_breached BOOLEAN := FALSE;
            BEGIN
                CASE alert_record.condition_operator
                    WHEN '>' THEN
                        condition_breached := current_metric_value > alert_record.threshold_value;
                    WHEN '<' THEN
                        condition_breached := current_metric_value < alert_record.threshold_value;
                    WHEN '>=' THEN
                        condition_breached := current_metric_value >= alert_record.threshold_value;
                    WHEN '<=' THEN
                        condition_breached := current_metric_value <= alert_record.threshold_value;
                    WHEN '=' THEN
                        condition_breached := current_metric_value = alert_record.threshold_value;
                    WHEN '!=' THEN
                        condition_breached := current_metric_value != alert_record.threshold_value;
                    WHEN 'between' THEN
                        condition_breached := current_metric_value BETWEEN alert_record.threshold_value AND alert_record.threshold_value_2;
                END CASE;

                -- Check for consecutive breaches
                IF condition_breached THEN
                    SELECT COUNT(*) INTO breach_count
                    FROM monitoring_metrics
                    WHERE metric_name = alert_record.metric_name
                        AND timestamp > NOW() - alert_record.evaluation_window
                        AND CASE alert_record.condition_operator
                            WHEN '>' THEN metric_value > alert_record.threshold_value
                            WHEN '<' THEN metric_value < alert_record.threshold_value
                            WHEN '>=' THEN metric_value >= alert_record.threshold_value
                            WHEN '<=' THEN metric_value <= alert_record.threshold_value
                            WHEN '=' THEN metric_value = alert_record.threshold_value
                            WHEN '!=' THEN metric_value != alert_record.threshold_value
                            WHEN 'between' THEN metric_value BETWEEN alert_record.threshold_value AND alert_record.threshold_value_2
                        END;

                    -- Only trigger if consecutive breaches threshold is met
                    IF breach_count >= alert_record.consecutive_breaches THEN
                        INSERT INTO alert_evaluation_results
                        VALUES (
                            alert_record.alert_name,
                            current_metric_value,
                            alert_record.threshold_value,
                            TRUE,
                            alert_record.severity,
                            format('Alert: %s - Current value: %s %s threshold: %s',
                                   alert_record.alert_name,
                                   current_metric_value,
                                   alert_record.condition_operator,
                                   alert_record.threshold_value)
                        );
                    END IF;
                END IF;
            END;
        END IF;
    END LOOP;

    -- Return results
    RETURN QUERY SELECT * FROM alert_evaluation_results;

    -- Clean up
    DROP TABLE IF EXISTS alert_evaluation_results;
END;
$$ LANGUAGE plpgsql;

-- Function to create alert incident
CREATE OR REPLACE FUNCTION create_alert_incident(
    alert_name_param VARCHAR(100),
    current_value_param NUMERIC,
    threshold_value_param NUMERIC,
    severity_param VARCHAR(20),
    message_param TEXT
) RETURNS UUID AS $$
DECLARE
    alert_config_id UUID;
    incident_id UUID := uuid_generate_v4();
    existing_incident RECORD;
BEGIN
    -- Get alert configuration
    SELECT id INTO alert_config_id
    FROM alert_configuration
    WHERE alert_name = alert_name_param;

    -- Check if there's already a firing incident for this alert
    SELECT * INTO existing_incident
    FROM alert_incidents
    WHERE alert_configuration_id = alert_config_id
        AND status = 'firing'
        AND started_at > NOW() - INTERVAL '1 hour';

    IF existing_incident IS NOT NULL THEN
        -- Update existing incident
        UPDATE alert_incidents SET
            metric_value = current_value_param,
            message = message_param,
            started_at = CASE
                WHEN existing_incident.started_at < NOW() - INTERVAL '5 minutes' THEN existing_incident.started_at
                ELSE NOW()
            END
        WHERE id = existing_incident.id;

        RETURN existing_incident.incident_id;
    ELSE
        -- Create new incident
        INSERT INTO alert_incidents (
            alert_configuration_id,
            incident_id,
            status,
            severity,
            message,
            metric_value,
            threshold_value
        ) VALUES (
            alert_config_id,
            incident_id,
            'firing',
            severity_param,
            message_param,
            current_value_param,
            threshold_value_param
        );

        RETURN incident_id;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Function to resolve alert incidents
CREATE OR REPLACE FUNCTION resolve_alert_incident(
    incident_id_param UUID,
    resolved_by_param VARCHAR(100) DEFAULT 'system'
) RETURNS BOOLEAN AS $$
BEGIN
    UPDATE alert_incidents SET
        status = 'resolved',
        resolved_at = NOW(),
        duration_seconds = EXTRACT(EPOCH FROM (NOW() - started_at))::integer,
        metadata = jsonb_set(metadata, '{resolved_by}', to_jsonb(resolved_by_param))
    WHERE incident_id = incident_id_param
        AND status = 'firing';

    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 4. DASHBOARD CREATION FUNCTIONS
-- =====================================================

-- Function to create default dashboards
CREATE OR REPLACE FUNCTION create_default_dashboards()
RETURNS void AS $$
BEGIN
    -- System Overview Dashboard
    INSERT INTO dashboard_configuration (dashboard_name, dashboard_type, layout_config, widgets, refresh_interval_seconds)
    VALUES (
        'system_overview',
        'system_overview',
        jsonb_build_object('columns', 3, 'rows', 3),
        jsonb_build_array(
            jsonb_build_object(
                'id', 'database_health',
                'type', 'single_stat',
                'title', 'Database Health',
                'metric', 'database.health.status',
                'position', jsonb_build_object('x', 0, 'y', 0, 'w', 1, 'h', 1)
            ),
            jsonb_build_object(
                'id', 'active_connections',
                'type', 'single_stat',
                'title', 'Active Connections',
                'metric', 'database.connections.active',
                'position', jsonb_build_object('x', 1, 'y', 0, 'w', 1, 'h', 1)
            ),
            jsonb_build_object(
                'id', 'cache_hit_ratio',
                'type', 'single_stat',
                'title', 'Cache Hit Ratio',
                'metric', 'database.cache.hit_ratio',
                'position', jsonb_build_object('x', 2, 'y', 0, 'w', 1, 'h', 1)
            ),
            jsonb_build_object(
                'id', 'workflow_activity',
                'type', 'line_chart',
                'title', 'Workflow Activity (24h)',
                'metrics', jsonb_build_array('workflows.active', 'workflows.completed.daily'),
                'position', jsonb_build_object('x', 0, 'y', 1, 'w', 2, 'h', 2)
            ),
            jsonb_build_object(
                'id', 'query_performance',
                'type', 'bar_chart',
                'title', 'Average Query Time',
                'metric', 'performance.query.avg_time',
                'position', jsonb_build_object('x', 2, 'y', 1, 'w', 1, 'h', 2)
            )
        ),
        30
    )
    ON CONFLICT (dashboard_name) DO NOTHING;

    -- Performance Dashboard
    INSERT INTO dashboard_configuration (dashboard_name, dashboard_type, layout_config, widgets, refresh_interval_seconds)
    VALUES (
        'performance_metrics',
        'performance',
        jsonb_build_object('columns', 4, 'rows', 3),
        jsonb_build_array(
            jsonb_build_object(
                'id', 'query_time_distribution',
                'type', 'histogram',
                'title', 'Query Time Distribution',
                'metric', 'performance.query.avg_time',
                'position', jsonb_build_object('x', 0, 'y', 0, 'w', 2, 'h', 2)
            ),
            jsonb_build_object(
                'id', 'lock_waits',
                'type', 'single_stat',
                'title', 'Lock Waits',
                'metric', 'performance.lock_waits',
                'position', jsonb_build_object('x', 2, 'y', 0, 'w', 1, 'h', 1)
            ),
            jsonb_build_object(
                'id', 'slow_queries',
                'type', 'single_stat',
                'title', 'Slow Queries',
                'metric', 'performance.queries.slow',
                'position', jsonb_build_object('x', 3, 'y', 0, 'w', 1, 'h', 1)
            ),
            jsonb_build_object(
                'id', 'wal_throughput',
                'type', 'line_chart',
                'title', 'WAL Write Throughput',
                'metric', 'performance.wal.write_bytes',
                'position', jsonb_build_object('x', 2, 'y', 1, 'w', 2, 'h', 2)
            )
        ),
        60
    )
    ON CONFLICT (dashboard_name) DO NOTHING;

    -- Alerts Dashboard
    INSERT INTO dashboard_configuration (dashboard_name, dashboard_type, layout_config, widgets, refresh_interval_seconds)
    VALUES (
        'alerts_overview',
        'alerts',
        jsonb_build_object('columns', 2, 'rows', 3),
        jsonb_build_array(
            jsonb_build_object(
                'id', 'active_alerts',
                'type', 'alert_list',
                'title', 'Active Alerts',
                'position', jsonb_build_object('x', 0, 'y', 0, 'w', 2, 'h', 2)
            ),
            jsonb_build_object(
                'id', 'alert_history',
                'type', 'timeline',
                'title', 'Recent Alert History',
                'position', jsonb_build_object('x', 0, 'y', 2, 'w', 2, 'h', 1)
            )
        ),
        15
    )
    ON CONFLICT (dashboard_name) DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 5. DEFAULT ALERT CONFIGURATIONS
-- =====================================================

-- Function to create default alert configurations
CREATE OR REPLACE FUNCTION create_default_alert_configurations()
RETURNS void AS $$
BEGIN
    -- Database connection alerts
    INSERT INTO alert_configuration (alert_name, alert_type, metric_name, condition_operator, threshold_value, severity, evaluation_window, consecutive_breaches)
    VALUES
        ('high_connections', 'threshold', 'database.connections.active', '>', 150, 'warning', '1 minute', 2),
        ('critical_connections', 'threshold', 'database.connections.active', '>', 200, 'critical', '1 minute', 1),
        ('no_connections', 'threshold', 'database.connections.total', '<', 1, 'critical', '5 minutes', 3),

    -- Performance alerts
        ('slow_queries', 'threshold', 'performance.query.avg_time', '>', 5000, 'warning', '5 minutes', 2),
        ('critical_slow_queries', 'threshold', 'performance.query.avg_time', '>', 10000, 'critical', '5 minutes', 1),
        ('high_lock_waits', 'threshold', 'performance.lock_waits', '>', 5, 'warning', '1 minute', 3),
        ('critical_lock_waits', 'threshold', 'performance.lock_waits', '>', 20, 'critical', '1 minute', 1),

    -- Cache performance alerts
        ('low_cache_hit_ratio', 'threshold', 'database.cache.hit_ratio', '<', 90, 'warning', '5 minutes', 2),
        ('critical_cache_hit_ratio', 'threshold', 'database.cache.hit_ratio', '<', 80, 'critical', '5 minutes', 1),

    -- Workflow-specific alerts
        ('high_active_workflows', 'threshold', 'workflows.active', '>', 100, 'warning', '1 minute', 2),
        ('workflow_error_rate', 'threshold', 'workflows.error_rate', '>', 20, 'warning', '5 minutes', 2),
        ('critical_workflow_error_rate', 'threshold', 'workflows.error_rate', '>', 50, 'critical', '5 minutes', 1),

    -- Database health alerts
        ('database_unhealthy', 'threshold', 'database.health.status', '=', 0, 'critical', '1 minute', 1)

    ON CONFLICT (alert_name) DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 6. MONITORING VIEWS
-- =====================================================

-- Real-time monitoring dashboard view
CREATE OR REPLACE VIEW realtime_monitoring_dashboard AS
SELECT
    DATE_TRUNC('minute', timestamp) as time_bucket,
    AVG(CASE WHEN metric_name = 'database.connections.active' THEN metric_value END) as active_connections,
    AVG(CASE WHEN metric_name = 'database.cache.hit_ratio' THEN metric_value END) as cache_hit_ratio,
    AVG(CASE WHEN metric_name = 'performance.query.avg_time' THEN metric_value END) as avg_query_time_ms,
    AVG(CASE WHEN metric_name = 'workflows.active' THEN metric_value END) as active_workflows,
    AVG(CASE WHEN metric_name = 'workflows.error_rate' THEN metric_value END) as error_rate_percent,
    COUNT(DISTINCT CASE WHEN metric_name = 'performance.lock_waits' AND metric_value > 0 THEN timestamp END) as lock_wait_events
FROM monitoring_metrics
WHERE timestamp > NOW() - INTERVAL '1 hour'
GROUP BY DATE_TRUNC('minute', timestamp)
ORDER BY time_bucket DESC;

-- Current system status view
CREATE OR REPLACE VIEW current_system_status AS
SELECT
    metric_name,
    metric_value,
    metric_unit,
    CASE
        WHEN metric_name = 'database.connections.active' THEN
            CASE
                WHEN metric_value > 200 THEN 'critical'
                WHEN metric_value > 150 THEN 'warning'
                ELSE 'healthy'
            END
        WHEN metric_name = 'database.cache.hit_ratio' THEN
            CASE
                WHEN metric_value < 80 THEN 'critical'
                WHEN metric_value < 90 THEN 'warning'
                ELSE 'healthy'
            END
        WHEN metric_name = 'performance.query.avg_time' THEN
            CASE
                WHEN metric_value > 10000 THEN 'critical'
                WHEN metric_value > 5000 THEN 'warning'
                ELSE 'healthy'
            END
        WHEN metric_name = 'workflows.error_rate' THEN
            CASE
                WHEN metric_value > 50 THEN 'critical'
                WHEN metric_value > 20 THEN 'warning'
                ELSE 'healthy'
            END
        ELSE 'healthy'
    END as status,
    timestamp
FROM (
    SELECT DISTINCT ON (metric_name) metric_name, metric_value, metric_unit, timestamp
    FROM monitoring_metrics
    WHERE timestamp > NOW() - INTERVAL '10 minutes'
    ORDER BY metric_name, timestamp DESC
) latest_metrics;

-- Active alerts view
CREATE OR REPLACE VIEW active_alerts AS
SELECT
        ac.alert_name,
        ac.alert_type,
        ac.metric_name,
        ac.severity,
        ai.message,
        ai.metric_value,
        ai.threshold_value,
        ai.started_at,
        EXTRACT(EPOCH FROM (NOW() - ai.started_at)) as duration_seconds
FROM alert_configuration ac
JOIN alert_incidents ai ON ac.id = ai.alert_configuration_id
WHERE ai.status = 'firing'
ORDER BY ai.started_at DESC;

-- Alert trends view
CREATE OR REPLACE VIEW alert_trends AS
SELECT
    DATE_TRUNC('hour', started_at) as hour_bucket,
    severity,
    COUNT(*) as alert_count,
    COUNT(DISTINCT alert_configuration_id) as unique_alerts
FROM alert_incidents
WHERE started_at > NOW() - INTERVAL '24 hours'
GROUP BY DATE_TRUNC('hour', started_at), severity
ORDER BY hour_bucket DESC, severity;

-- =====================================================
-- 7. AUTOMATED MONITORING FUNCTIONS
-- =====================================================

-- Function to run complete monitoring cycle
CREATE OR REPLACE FUNCTION run_monitoring_cycle()
RETURNS TABLE(
    step VARCHAR(50),
    status VARCHAR(20),
    metrics_collected INTEGER,
    alerts_generated INTEGER,
    execution_time_ms INTEGER
) AS $$
DECLARE
    start_time TIMESTAMP;
    metrics_count INTEGER := 0;
    alerts_count INTEGER := 0;
BEGIN
    start_time := clock_timestamp();

    -- Collect system health metrics
    PERFORM collect_system_health_metrics();
    metrics_count := metrics_count + 5;

    -- Collect performance metrics
    PERFORM collect_performance_metrics();
    metrics_count := metrics_count + 5;

    -- Collect workflow metrics
    PERFORM collect_workflow_metrics();
    metrics_count := metrics_count + 5;

    -- Evaluate alert conditions
    FOR evaluation_record IN
        SELECT * FROM evaluate_alert_conditions()
        WHERE condition_met = true
    LOOP
        PERFORM create_alert_incident(
            evaluation_record.alert_name,
            evaluation_record.current_value,
            evaluation_record.threshold_value,
            evaluation_record.severity,
            evaluation_record.message
        );
        alerts_count := alerts_count + 1;
    END LOOP;

    RETURN QUERY
    SELECT 'monitoring_cycle'::VARCHAR(50), 'completed'::VARCHAR(20), metrics_count, alerts_count,
           EXTRACT(MILLISECONDS FROM (clock_timestamp() - start_time))::INTEGER;
END;
$$ LANGUAGE plpgsql;

-- Function to get monitoring summary
CREATE OR REPLACE FUNCTION get_monitoring_summary()
RETURNS JSONB AS $$
DECLARE
    summary JSONB;
BEGIN
    summary := jsonb_build_object(
        'timestamp', NOW(),
        'system_health', (
            SELECT jsonb_build_object(
                'status', COALESCE(status, 'unknown'),
                'active_connections', metric_value,
                'last_updated', timestamp
            )
            FROM current_system_status
            WHERE metric_name = 'database.connections.active'
            LIMIT 1
        ),
        'active_alerts', (
            SELECT jsonb_agg(
                jsonb_build_object(
                    'alert_name', alert_name,
                    'severity', severity,
                    'duration_seconds', duration_seconds,
                    'message', message
                )
            )
            FROM active_alerts
        ),
        'recent_metrics', (
            SELECT jsonb_agg(
                jsonb_build_object(
                    'metric_name', metric_name,
                    'current_value', metric_value,
                    'status', status,
                    'last_updated', timestamp
                )
            )
            FROM current_system_status
            LIMIT 10
        )
    );

    RETURN summary;
END;
$$ LANGUAGE plpgsql;

-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION collect_system_health_metrics() TO PUBLIC;
GRANT EXECUTE ON FUNCTION collect_performance_metrics() TO PUBLIC;
GRANT EXECUTE ON FUNCTION collect_workflow_metrics() TO PUBLIC;
GRANT EXECUTE ON FUNCTION evaluate_alert_conditions() TO PUBLIC;
GRANT EXECUTE ON FUNCTION create_alert_incident(VARCHAR(100), NUMERIC, NUMERIC, VARCHAR(20), TEXT) TO PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_alert_incident(UUID, VARCHAR(100)) TO PUBLIC;
GRANT EXECUTE ON FUNCTION create_default_dashboards() TO PUBLIC;
GRANT EXECUTE ON FUNCTION create_default_alert_configurations() TO PUBLIC;
GRANT EXECUTE ON FUNCTION run_monitoring_cycle() TO PUBLIC;
GRANT EXECUTE ON FUNCTION get_monitoring_summary() TO PUBLIC;

-- Grant access to monitoring views
GRANT SELECT ON realtime_monitoring_dashboard TO PUBLIC;
GRANT SELECT ON current_system_status TO PUBLIC;
GRANT SELECT ON active_alerts TO PUBLIC;
GRANT SELECT ON alert_trends TO PUBLIC;

-- Initialize default configurations
SELECT create_default_dashboards();
SELECT create_default_alert_configurations();

-- Set up scheduled monitoring (requires pg_cron extension)
-- SELECT cron.schedule('monitoring-cycle', '*/2 * * * *', 'SELECT run_monitoring_cycle();');

-- Log monitoring system setup completion
INSERT INTO system_metrics (metric_name, metric_value, metric_unit, metadata)
VALUES ('database_monitoring_dashboard_configured', 1, 'count',
        '{"timestamp": "' || NOW() || '", "phase": "week5-6_phase2"}');

\echo 'Database monitoring dashboard and alerting system completed successfully!'
\echo 'Monitoring features enabled:'
\echo '- Comprehensive metrics collection system'
\echo '- Real-time alerting with configurable thresholds'
\echo '- Customizable dashboard configurations'
\echo '- System health monitoring'
\echo '- Performance tracking and alerting'
\echo '- Workflow-specific monitoring'
\echo '- Alert incident management'
\echo '- Automated monitoring cycles'