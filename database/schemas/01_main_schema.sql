-- GUI-LOP Database Schema
-- PostgreSQL schema for persistent storage replacing in-memory Maps
-- Week 3, Phase 1 Database Implementation

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Create custom types
CREATE TYPE workflow_status AS ENUM (
    'created',
    'running',
    'waiting_for_human',
    'completed',
    'failed',
    'cancelled'
);

CREATE TYPE user_role AS ENUM (
    'admin',
    'user',
    'viewer'
);

CREATE TYPE permission_type AS ENUM (
    'read',
    'write',
    'execute',
    'admin'
);

CREATE TYPE event_type AS ENUM (
    'workflow_created',
    'workflow_started',
    'workflow_completed',
    'workflow_failed',
    'ui_generated',
    'human_response',
    'system_event'
);

-- Users table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    username VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255),
    role user_role DEFAULT 'user',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_login TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}'
);

-- Roles table
CREATE TABLE roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name user_role UNIQUE NOT NULL,
    description TEXT,
    permissions JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- User sessions table
CREATE TABLE user_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    session_token VARCHAR(255) UNIQUE NOT NULL,
    websocket_id VARCHAR(255),
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    is_active BOOLEAN DEFAULT true,
    metadata JSONB DEFAULT '{}'
);

-- Workflow templates table
CREATE TABLE workflow_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    template_key VARCHAR(100) UNIQUE NOT NULL,
    steps JSONB NOT NULL DEFAULT '[]',
    default_config JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Workflows table (replaces in-memory workflows Map)
CREATE TABLE workflows (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    template_id UUID REFERENCES workflow_templates(id),
    template_key VARCHAR(100) NOT NULL,
    title VARCHAR(255),
    description TEXT,
    status workflow_status DEFAULT 'created',
    context JSONB DEFAULT '{}',
    config JSONB DEFAULT '{}',
    ui_url VARCHAR(500),
    ui_components JSONB DEFAULT '[]',
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'
);

-- Workflow steps table
CREATE TABLE workflow_steps (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workflow_id UUID REFERENCES workflows(id) ON DELETE CASCADE,
    step_name VARCHAR(255) NOT NULL,
    step_order INTEGER NOT NULL,
    status workflow_status DEFAULT 'created',
    input_data JSONB DEFAULT '{}',
    output_data JSONB DEFAULT '{}',
    error_message TEXT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    metadata JSONB DEFAULT '{}',
    UNIQUE(workflow_id, step_order)
);

-- Human responses table
CREATE TABLE human_responses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workflow_id UUID REFERENCES workflows(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    step_id UUID REFERENCES workflow_steps(id) ON DELETE CASCADE,
    action VARCHAR(255) NOT NULL,
    response_data JSONB DEFAULT '{}',
    confidence_score DECIMAL(3,2) CHECK (confidence_score >= 0 AND confidence_score <= 1),
    reasoning TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'
);

-- Events table (for audit trail and analytics)
CREATE TABLE events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_type event_type NOT NULL,
    workflow_id UUID REFERENCES workflows(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    session_id UUID REFERENCES user_sessions(id) ON DELETE CASCADE,
    event_data JSONB DEFAULT '{}',
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Audit log table
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    table_name VARCHAR(100) NOT NULL,
    operation VARCHAR(20) NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
    record_id UUID NOT NULL,
    old_values JSONB,
    new_values JSONB,
    changed_by UUID REFERENCES users(id),
    changed_at TIMESTAMPTZ DEFAULT NOW(),
    session_id UUID REFERENCES user_sessions(id)
);

-- System configuration table
CREATE TABLE system_config (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    config_key VARCHAR(255) UNIQUE NOT NULL,
    config_value JSONB NOT NULL,
    description TEXT,
    is_public BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- API keys table
CREATE TABLE api_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    key_name VARCHAR(255) NOT NULL,
    api_key_hash VARCHAR(255) UNIQUE NOT NULL,
    permissions JSONB DEFAULT '[]',
    is_active BOOLEAN DEFAULT true,
    expires_at TIMESTAMPTZ,
    last_used TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Workflow execution metrics
CREATE TABLE workflow_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workflow_id UUID REFERENCES workflows(id) ON DELETE CASCADE,
    total_steps INTEGER NOT NULL,
    completed_steps INTEGER NOT NULL,
    execution_time_ms INTEGER,
    human_interaction_count INTEGER DEFAULT 0,
    success_rate DECIMAL(5,2),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for performance optimization

-- Users table indexes
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_active ON users(is_active);

-- User sessions indexes
CREATE INDEX idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX idx_user_sessions_token ON user_sessions(session_token);
CREATE INDEX idx_user_sessions_expires ON user_sessions(expires_at);
CREATE INDEX idx_user_sessions_active ON user_sessions(is_active);

-- Workflow templates indexes
CREATE INDEX idx_workflow_templates_key ON workflow_templates(template_key);
CREATE INDEX idx_workflow_templates_active ON workflow_templates(is_active);

-- Workflows table indexes
CREATE INDEX idx_workflows_template_id ON workflows(template_id);
CREATE INDEX idx_workflows_template_key ON workflows(template_key);
CREATE INDEX idx_workflows_status ON workflows(status);
CREATE INDEX idx_workflows_created_by ON workflows(created_by);
CREATE INDEX idx_workflows_created_at ON workflows(created_at);
CREATE INDEX idx_workflows_updated_at ON workflows(updated_at);
CREATE INDEX idx_workflows_status_created ON workflows(status, created_at);

-- Workflow steps indexes
CREATE INDEX idx_workflow_steps_workflow_id ON workflow_steps(workflow_id);
CREATE INDEX idx_workflow_steps_status ON workflow_steps(status);
CREATE INDEX idx_workflow_steps_workflow_order ON workflow_steps(workflow_id, step_order);

-- Human responses indexes
CREATE INDEX idx_human_responses_workflow_id ON human_responses(workflow_id);
CREATE INDEX idx_human_responses_user_id ON human_responses(user_id);
CREATE INDEX idx_human_responses_created_at ON human_responses(created_at);

-- Events table indexes
CREATE INDEX idx_events_type ON events(event_type);
CREATE INDEX idx_events_workflow_id ON events(workflow_id);
CREATE INDEX idx_events_user_id ON events(user_id);
CREATE INDEX idx_events_created_at ON events(created_at);
CREATE INDEX idx_events_type_created ON events(event_type, created_at);

-- Audit logs indexes
CREATE INDEX idx_audit_logs_table_record ON audit_logs(table_name, record_id);
CREATE INDEX idx_audit_logs_operation ON audit_logs(operation);
CREATE INDEX idx_audit_logs_changed_at ON audit_logs(changed_at);
CREATE INDEX idx_audit_logs_changed_by ON audit_logs(changed_by);

-- System config indexes
CREATE INDEX idx_system_config_key ON system_config(config_key);
CREATE INDEX idx_system_config_public ON system_config(is_public);

-- API keys indexes
CREATE INDEX idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX idx_api_keys_hash ON api_keys(api_key_hash);
CREATE INDEX idx_api_keys_active ON api_keys(is_active);

-- Workflow metrics indexes
CREATE INDEX idx_workflow_metrics_workflow_id ON workflow_metrics(workflow_id);

-- Create trigger functions for updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updated_at columns
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_roles_updated_at BEFORE UPDATE ON roles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_workflow_templates_updated_at BEFORE UPDATE ON workflow_templates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_workflows_updated_at BEFORE UPDATE ON workflows
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_workflow_steps_updated_at BEFORE UPDATE ON workflow_steps
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_system_config_updated_at BEFORE UPDATE ON system_config
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_api_keys_updated_at BEFORE UPDATE ON api_keys
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create audit trigger function
CREATE OR REPLACE FUNCTION audit_trigger_function()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        INSERT INTO audit_logs (table_name, operation, record_id, old_values, changed_at)
        VALUES (TG_TABLE_NAME, TG_OP, OLD.id, row_to_json(OLD), NOW());
        RETURN OLD;
    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO audit_logs (table_name, operation, record_id, old_values, new_values, changed_at)
        VALUES (TG_TABLE_NAME, TG_OP, NEW.id, row_to_json(OLD), row_to_json(NEW), NOW());
        RETURN NEW;
    ELSIF TG_OP = 'INSERT' THEN
        INSERT INTO audit_logs (table_name, operation, record_id, new_values, changed_at)
        VALUES (TG_TABLE_NAME, TG_OP, NEW.id, row_to_json(NEW), NOW());
        RETURN NEW;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Create audit triggers (optional, can be enabled per table)
-- Example: CREATE TRIGGER audit_workflows_trigger AFTER INSERT OR UPDATE OR DELETE ON workflows
--          FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

-- Create view for active workflows with status
CREATE VIEW active_workflows AS
SELECT
    w.*,
    t.name as template_name,
    u.username as created_by_username,
    u.full_name as created_by_full_name,
    CASE
        WHEN w.status = 'running' THEN NOW() - w.started_at
        WHEN w.status = 'waiting_for_human' THEN NOW() - w.started_at
        ELSE NULL
    END as duration
FROM workflows w
LEFT JOIN workflow_templates t ON w.template_id = t.id
LEFT JOIN users u ON w.created_by = u.id
WHERE w.status IN ('created', 'running', 'waiting_for_human');

-- Create view for workflow analytics
CREATE VIEW workflow_analytics AS
SELECT
    DATE_TRUNC('day', w.created_at) as date,
    w.template_key,
    w.status,
    COUNT(*) as count,
    AVG(EXTRACT(EPOCH FROM (w.completed_at - w.started_at))) as avg_execution_time_seconds,
    COUNT(h.id) as human_interactions
FROM workflows w
LEFT JOIN human_responses h ON w.id = h.workflow_id
WHERE w.created_at >= NOW() - INTERVAL '30 days'
GROUP BY DATE_TRUNC('day', w.created_at), w.template_key, w.status
ORDER BY date DESC, count DESC;

-- Create view for user activity
CREATE VIEW user_activity AS
SELECT
    u.id,
    u.username,
    u.full_name,
    COUNT(DISTINCT w.id) as workflow_count,
    COUNT(DISTINCT s.id) as session_count,
    MAX(s.created_at) as last_session,
    COUNT(DISTINCT h.id) as human_response_count
FROM users u
LEFT JOIN workflows w ON u.id = w.created_by
LEFT JOIN user_sessions s ON u.id = s.user_id
LEFT JOIN human_responses h ON u.id = h.user_id
GROUP BY u.id, u.username, u.full_name
ORDER BY workflow_count DESC;