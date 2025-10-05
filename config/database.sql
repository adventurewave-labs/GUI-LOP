-- GUI-LOP Database Schema
-- PostgreSQL schema for the Generative UI & Human-in-the-Loop Orchestration Platform

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Sessions table
-- Stores user sessions for WebSocket connections and API access
CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    metadata JSONB DEFAULT '{}',
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'expired', 'terminated')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_activity TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE
);

-- Workflows table
-- Stores workflow instances and their execution state
CREATE TABLE IF NOT EXISTS workflows (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    template_id VARCHAR(50) NOT NULL,
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    state JSONB NOT NULL DEFAULT '{}',
    status VARCHAR(20) DEFAULT 'created' CHECK (status IN ('created', 'running', 'paused', 'completed', 'failed', 'cancelled')),
    error TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    cancelled_at TIMESTAMP WITH TIME ZONE,
    cancelled_by VARCHAR(100),
    cancellation_reason TEXT
);

-- Events table
-- Stores AG-UI protocol events for agent-UI communication
CREATE TABLE IF NOT EXISTS events (
    id VARCHAR(100) PRIMARY KEY,
    type VARCHAR(50) NOT NULL CHECK (type IN (
        'tool_input_request',
        'ui_update',
        'approval_request',
        'data_display',
        'workflow_status',
        'event_response'
    )),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    workflow_id UUID REFERENCES workflows(id) ON DELETE SET NULL,
    data JSONB NOT NULL DEFAULT '{}',
    priority VARCHAR(20) DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
    source VARCHAR(20) DEFAULT 'agent' CHECK (source IN ('agent', 'human', 'system')),
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    processed BOOLEAN DEFAULT FALSE,
    original_event_id VARCHAR(100) REFERENCES events(id) ON DELETE SET NULL
);

-- API keys table
-- Stores API keys for external access
CREATE TABLE IF NOT EXISTS api_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    key_hash VARCHAR(255) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    user_id UUID NOT NULL,
    permissions JSONB DEFAULT '[]',
    active BOOLEAN DEFAULT TRUE,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_used TIMESTAMP WITH TIME ZONE,
    created_by VARCHAR(100)
);

-- Data display logs table
-- Logs data display events for analytics
CREATE TABLE IF NOT EXISTS data_display_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    workflow_id UUID REFERENCES workflows(id) ON DELETE SET NULL,
    display_type VARCHAR(50) NOT NULL,
    data_size INTEGER NOT NULL,
    metadata JSONB DEFAULT '{}',
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Workflow history table
-- Tracks workflow execution history and node transitions
CREATE TABLE IF NOT EXISTS workflow_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    node_name VARCHAR(100) NOT NULL,
    action VARCHAR(50) NOT NULL,
    state_before JSONB,
    state_after JSONB,
    duration_ms INTEGER,
    error_message TEXT,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- User interactions table
-- Tracks human interactions with workflows and UI components
CREATE TABLE IF NOT EXISTS user_interactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    workflow_id UUID REFERENCES workflows(id) ON DELETE SET NULL,
    event_id VARCHAR(100) REFERENCES events(id) ON DELETE SET NULL,
    interaction_type VARCHAR(50) NOT NULL,
    interaction_data JSONB DEFAULT '{}',
    user_id UUID,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Workflow templates table
-- Stores workflow templates and their configurations
CREATE TABLE IF NOT EXISTS workflow_templates (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    template_data JSONB NOT NULL,
    version VARCHAR(20) DEFAULT '1.0.0',
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by VARCHAR(100)
);

-- UI components registry
-- Stores reusable UI component definitions
CREATE TABLE IF NOT EXISTS ui_components (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    type VARCHAR(50) NOT NULL,
    definition JSONB NOT NULL,
    version VARCHAR(20) DEFAULT '1.0.0',
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- System metrics table
-- Stores system performance and usage metrics
CREATE TABLE IF NOT EXISTS system_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    metric_name VARCHAR(100) NOT NULL,
    metric_value NUMERIC NOT NULL,
    metric_unit VARCHAR(20),
    metadata JSONB DEFAULT '{}',
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Error logs table
-- Stores system error logs for debugging
CREATE TABLE IF NOT EXISTS error_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
    workflow_id UUID REFERENCES workflows(id) ON DELETE SET NULL,
    error_type VARCHAR(50) NOT NULL,
    error_message TEXT NOT NULL,
    stack_trace TEXT,
    metadata JSONB DEFAULT '{}',
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance optimization

-- Sessions indexes
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_last_activity ON sessions(last_activity);

-- Workflows indexes
CREATE INDEX IF NOT EXISTS idx_workflows_session_id ON workflows(session_id);
CREATE INDEX IF NOT EXISTS idx_workflows_template_id ON workflows(template_id);
CREATE INDEX IF NOT EXISTS idx_workflows_status ON workflows(status);
CREATE INDEX IF NOT EXISTS idx_workflows_created_at ON workflows(created_at);
CREATE INDEX IF NOT EXISTS idx_workflows_updated_at ON workflows(updated_at);

-- Events indexes
CREATE INDEX IF NOT EXISTS idx_events_session_id ON events(session_id);
CREATE INDEX IF NOT EXISTS idx_events_workflow_id ON events(workflow_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
CREATE INDEX IF NOT EXISTS idx_events_processed ON events(processed);
CREATE INDEX IF NOT EXISTS idx_events_priority ON events(priority);
CREATE INDEX IF NOT EXISTS idx_events_source ON events(source);

-- API keys indexes
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(active);
CREATE INDEX IF NOT EXISTS idx_api_keys_expires_at ON api_keys(expires_at);

-- Data display logs indexes
CREATE INDEX IF NOT EXISTS idx_data_display_logs_session_id ON data_display_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_data_display_logs_workflow_id ON data_display_logs(workflow_id);
CREATE INDEX IF NOT EXISTS idx_data_display_logs_display_type ON data_display_logs(display_type);
CREATE INDEX IF NOT EXISTS idx_data_display_logs_timestamp ON data_display_logs(timestamp);

-- Workflow history indexes
CREATE INDEX IF NOT EXISTS idx_workflow_history_workflow_id ON workflow_history(workflow_id);
CREATE INDEX IF NOT EXISTS idx_workflow_history_timestamp ON workflow_history(timestamp);
CREATE INDEX IF NOT EXISTS idx_workflow_history_node_name ON workflow_history(node_name);

-- User interactions indexes
CREATE INDEX IF NOT EXISTS idx_user_interactions_session_id ON user_interactions(session_id);
CREATE INDEX IF NOT EXISTS idx_user_interactions_workflow_id ON user_interactions(workflow_id);
CREATE INDEX IF NOT EXISTS idx_user_interactions_interaction_type ON user_interactions(interaction_type);
CREATE INDEX IF NOT EXISTS idx_user_interactions_timestamp ON user_interactions(timestamp);

-- System metrics indexes
CREATE INDEX IF NOT EXISTS idx_system_metrics_name ON system_metrics(metric_name);
CREATE INDEX IF NOT EXISTS idx_system_metrics_timestamp ON system_metrics(timestamp);

-- Error logs indexes
CREATE INDEX IF NOT EXISTS idx_error_logs_session_id ON error_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_error_logs_workflow_id ON error_logs(workflow_id);
CREATE INDEX IF NOT EXISTS idx_error_logs_error_type ON error_logs(error_type);
CREATE INDEX IF NOT EXISTS idx_error_logs_timestamp ON error_logs(timestamp);

-- Create composite indexes for common query patterns

-- For getting recent events for a session
CREATE INDEX IF NOT EXISTS idx_events_session_timestamp ON events(session_id, timestamp DESC);

-- For getting workflow status updates
CREATE INDEX IF NOT EXISTS idx_events_workflow_type ON events(workflow_id, type, timestamp DESC);

-- For active sessions with workflows
CREATE INDEX IF NOT EXISTS idx_sessions_workflows ON sessions(status, last_activity DESC)
    WHERE status = 'active';

-- For workflow execution tracking
CREATE INDEX IF NOT EXISTS idx_workflow_history_execution ON workflow_history(workflow_id, timestamp DESC);

-- Create views for common queries

-- Active sessions view
CREATE OR REPLACE VIEW active_sessions AS
SELECT
    s.id,
    s.user_id,
    s.created_at,
    s.last_activity,
    s.expires_at,
    COUNT(w.id) as workflow_count,
    COUNT(CASE WHEN w.status = 'running' THEN 1 END) as running_workflows,
    COUNT(e.id) as total_events
FROM sessions s
LEFT JOIN workflows w ON s.id = w.session_id
LEFT JOIN events e ON s.id = e.session_id
WHERE s.status = 'active'
    AND (s.expires_at IS NULL OR s.expires_at > NOW())
GROUP BY s.id, s.user_id, s.created_at, s.last_activity, s.expires_at;

-- Workflow summary view
CREATE OR REPLACE VIEW workflow_summary AS
SELECT
    w.id,
    w.template_id,
    w.session_id,
    w.status,
    w.created_at,
    w.updated_at,
    w.completed_at,
    COUNT(e.id) as event_count,
    COUNT(wh.id) as history_entries,
    COUNT(ui.id) as user_interactions,
    EXTRACT(EPOCH FROM (w.updated_at - w.created_at)) as duration_seconds
FROM workflows w
LEFT JOIN events e ON w.id = e.workflow_id
LEFT JOIN workflow_history wh ON w.id = wh.workflow_id
LEFT JOIN user_interactions ui ON w.id = ui.workflow_id
GROUP BY w.id, w.template_id, w.session_id, w.status, w.created_at, w.updated_at, w.completed_at;

-- Event type statistics view
CREATE OR REPLACE VIEW event_statistics AS
SELECT
    type,
    COUNT(*) as total_count,
    COUNT(CASE WHEN timestamp > NOW() - INTERVAL '1 hour' THEN 1 END) as last_hour_count,
    COUNT(CASE WHEN timestamp > NOW() - INTERVAL '24 hours' THEN 1 END) as last_24h_count,
    COUNT(CASE WHEN timestamp > NOW() - INTERVAL '7 days' THEN 1 END) as last_7d_count,
    COUNT(DISTINCT session_id) as unique_sessions,
    COUNT(DISTINCT workflow_id) as unique_workflows
FROM events
GROUP BY type;

-- Create functions for common operations

-- Function to clean up expired sessions
CREATE OR REPLACE FUNCTION cleanup_expired_sessions()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM sessions
    WHERE status = 'expired'
        OR (expires_at IS NOT NULL AND expires_at < NOW())
        OR (last_activity < NOW() - INTERVAL '7 days' AND status != 'active');

    GET DIAGNOSTICS deleted_count = ROW_COUNT;

    INSERT INTO system_metrics (metric_name, metric_value, metric_unit)
    VALUES ('expired_sessions_cleaned', deleted_count, 'count');

    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Function to get workflow execution metrics
CREATE OR REPLACE FUNCTION get_workflow_metrics(workflow_id_param UUID)
RETURNS TABLE(
    node_name VARCHAR,
    action VARCHAR,
    duration_ms INTEGER,
    error_count INTEGER,
    success_count INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        wh.node_name,
        wh.action,
        wh.duration_ms,
        COUNT(CASE WHEN wh.error_message IS NOT NULL THEN 1 END) as error_count,
        COUNT(CASE WHEN wh.error_message IS NULL THEN 1 END) as success_count
    FROM workflow_history wh
    WHERE wh.workflow_id = workflow_id_param
    GROUP BY wh.node_name, wh.action, wh.duration_ms
    ORDER BY wh.timestamp;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for automatic timestamp updates

-- Update workflow updated_at on state change
CREATE OR REPLACE FUNCTION update_workflow_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_workflow_updated_at
    BEFORE UPDATE ON workflows
    FOR EACH ROW
    EXECUTE FUNCTION update_workflow_updated_at();

-- Log workflow history on state change
CREATE OR REPLACE FUNCTION log_workflow_history()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.state IS DISTINCT FROM NEW.state THEN
        INSERT INTO workflow_history (workflow_id, node_name, action, state_before, state_after)
        VALUES (
            NEW.id,
            COALESCE(NEW.state->>'current_node', 'unknown'),
            'state_change',
            OLD.state,
            NEW.state
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_log_workflow_history
    AFTER UPDATE ON workflows
    FOR EACH ROW
    WHEN (OLD.state IS DISTINCT FROM NEW.state)
    EXECUTE FUNCTION log_workflow_history();

-- Create sample data for development (optional)
-- Uncomment for development environment

-- INSERT INTO workflow_templates (id, name, description, template_data) VALUES
-- ('data-analysis', 'Data Analysis Workflow', 'Analyze data with human insights', '{"nodes": ["data_ingestion", "analysis", "human_approval"]}'),
-- ('decision-making', 'Decision Making', 'Collaborative decision making', '{"nodes": ["context_analysis", "option_generation", "human_selection"]}'),
-- ('content-creation', 'Content Creation', 'Generate content with human review', '{"nodes": ["requirements", "generation", "human_review", "revision"]}');

-- INSERT INTO ui_components (name, type, definition) VALUES
-- ('text_input', 'text_input', '{"placeholder": "Enter text...", "required": true}'),
-- ('approval_buttons', 'button_group', '{"buttons": ["Approve", "Reject"], "style": "primary"}'),
-- ('data_table', 'table', '{"columns": [], "sortable": true, "filterable": true}');

-- Grant permissions (adjust as needed for your environment)
-- GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO gui_lop_user;
-- GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO gui_lop_user;

-- Create final verification query
DO $$
BEGIN
    RAISE NOTICE 'GUI-LOP database schema created successfully!';
    RAISE NOTICE 'Tables created: %', (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public');
    RAISE NOTICE 'Indexes created: %', (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public');
    RAISE NOTICE 'Views created: %', (SELECT count(*) FROM information_schema.views WHERE table_schema = 'public');
    RAISE NOTICE 'Functions created: %', (SELECT count(*) FROM information_schema.routines WHERE routine_schema = 'public' AND routine_type = 'FUNCTION');
    RAISE NOTICE 'Triggers created: %', (SELECT count(*) FROM information_schema.triggers WHERE trigger_schema = 'public');
END $$;