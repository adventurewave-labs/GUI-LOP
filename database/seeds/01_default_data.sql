-- Default Data Seeding Script
-- Populates the database with initial data for GUI-LOP platform
-- Week 3, Phase 1 - Default seeds for development and production

-- Insert default roles
INSERT INTO roles (id, name, description, permissions) VALUES
  (uuid_generate_v4(), 'admin', 'System administrator with full access', '["read", "write", "execute", "admin"]'),
  (uuid_generate_v4(), 'user', 'Regular user with standard permissions', '["read", "write", "execute"]'),
  (uuid_generate_v4(), 'viewer', 'Read-only access to workflows and data', '["read"]')
ON CONFLICT (name) DO NOTHING;

-- Insert default system configuration
INSERT INTO system_config (config_key, config_value, description, is_public) VALUES
  ('app.name', '"GUI-LOP"', 'Application name', true),
  ('app.version', '"1.0.0"', 'Application version', true),
  ('workflow.max_concurrent', '10', 'Maximum concurrent workflows per user', false),
  ('workflow.timeout_minutes', '60', 'Default workflow timeout in minutes', false),
  ('session.timeout_hours', '24', 'Session timeout in hours', false),
  ('ui.default_theme', '"light"', 'Default UI theme', true),
  ('ui.max_upload_size_mb', '50', 'Maximum file upload size in MB', true),
  ('notification.email_enabled', 'true', 'Enable email notifications', false),
  ('backup.auto_enabled', 'true', 'Enable automatic backups', false),
  ('backup.retention_days', '30', 'Backup retention period in days', false)
ON CONFLICT (config_key) DO NOTHING;

-- Insert default workflow templates
INSERT INTO workflow_templates (id, name, description, template_key, steps, default_config, created_by) VALUES
  (
    uuid_generate_v4(),
    'Data Analysis Workflow',
    'Analyze data and generate insights with human approval',
    'data-analysis',
    '[
      {
        "name": "Data Ingestion",
        "description": "Collect and validate input data",
        "type": "automated",
        "required": true
      },
      {
        "name": "Analysis",
        "description": "Perform statistical analysis",
        "type": "automated",
        "required": true
      },
      {
        "name": "Insight Generation",
        "description": "Generate insights and recommendations",
        "type": "ai_assisted",
        "required": true
      },
      {
        "name": "Human Review",
        "description": "Review and validate insights",
        "type": "human_input",
        "required": true
      },
      {
        "name": "Final Report",
        "description": "Create final analysis report",
        "type": "automated",
        "required": false
      }
    ]',
    '{
      "timeout_minutes": 45,
      "require_human_approval": true,
      "auto_save_interval": 300,
      "notification_on_completion": true
    }',
    (SELECT id FROM roles WHERE name = 'admin' LIMIT 1)
  ),
  (
    uuid_generate_v4(),
    'Decision Making Workflow',
    'Generate options and collect human input for decisions',
    'decision-making',
    '[
      {
        "name": "Context Analysis",
        "description": "Analyze decision context and constraints",
        "type": "automated",
        "required": true
      },
      {
        "name": "Option Generation",
        "description": "Generate viable options",
        "type": "ai_assisted",
        "required": true
      },
      {
        "name": "Human Selection",
        "description": "Human selects preferred option",
        "type": "human_input",
        "required": true
      },
      {
        "name": "Reasoning",
        "description": "Document reasoning for selection",
        "type": "human_input",
        "required": true
      },
      {
        "name": "Confidence Assessment",
        "description": "Assess confidence in decision",
        "type": "automated",
        "required": false
      }
    ]',
    '{
      "timeout_minutes": 30,
      "require_human_approval": true,
      "min_confidence_score": 0.7,
      "allow_multiple_selections": false
    }',
    (SELECT id FROM roles WHERE name = 'admin' LIMIT 1)
  ),
  (
    uuid_generate_v4(),
    'Content Creation Workflow',
    'Create content with human review and revision',
    'content-creation',
    '[
      {
        "name": "Requirements",
        "description": "Gather content requirements",
        "type": "human_input",
        "required": true
      },
      {
        "name": "Content Generation",
        "description": "Generate initial content",
        "type": "ai_assisted",
        "required": true
      },
      {
        "name": "Human Review",
        "description": "Review and edit content",
        "type": "human_input",
        "required": true
      },
      {
        "name": "Revision",
        "description": "Apply revisions and improvements",
        "type": "ai_assisted",
        "required": true
      },
      {
        "name": "Finalization",
        "description": "Final approval and publication",
        "type": "human_input",
        "required": true
      }
    ]',
    '{
      "timeout_minutes": 60,
      "require_human_approval": true,
      "max_revision_cycles": 3,
      "auto_save_drafts": true
    }',
    (SELECT id FROM roles WHERE name = 'admin' LIMIT 1)
  ),
  (
    uuid_generate_v4(),
    'Quality Assurance Workflow',
    'Systematic testing and validation process',
    'quality-assurance',
    '[
      {
        "name": "Test Planning",
        "description": "Define test requirements and scope",
        "type": "human_input",
        "required": true
      },
      {
        "name": "Automated Testing",
        "description": "Run automated test suites",
        "type": "automated",
        "required": true
      },
      {
        "name": "Manual Testing",
        "description": "Perform manual exploratory testing",
        "type": "human_input",
        "required": true
      },
      {
        "name": "Bug Analysis",
        "description": "Analyze and categorize issues",
        "type": "ai_assisted",
        "required": true
      },
      {
        "name": "Approval Decision",
        "description": "Final quality approval",
        "type": "human_input",
        "required": true
      }
    ]',
    '{
      "timeout_minutes": 90,
      "require_human_approval": true,
      "bug_threshold": 0,
      "coverage_threshold": 80
    }',
    (SELECT id FROM roles WHERE name = 'admin' LIMIT 1)
  )
ON CONFLICT (template_key) DO NOTHING;

-- Create default admin user (password: admin123 - change in production)
-- Note: This uses a simple hash for demonstration. Use bcrypt or similar in production
INSERT INTO users (id, email, username, password_hash, full_name, role, is_active) VALUES
  (
    uuid_generate_v4(),
    'admin@gui-lop.com',
    'admin',
    crypt('admin123', gen_salt('md5')),
    'System Administrator',
    'admin',
    true
  )
ON CONFLICT (email) DO NOTHING;

-- Create sample regular user for testing
INSERT INTO users (id, email, username, password_hash, full_name, role, is_active) VALUES
  (
    uuid_generate_v4(),
    'demo@gui-lop.com',
    'demo_user',
    crypt('demo123', gen_salt('md5')),
    'Demo User',
    'user',
    true
  )
ON CONFLICT (email) DO NOTHING;

-- Insert sample workflows for demonstration (using existing template data)
DO $$
DECLARE
  data_analysis_template UUID;
  decision_making_template UUID;
  content_creation_template UUID;
  admin_user UUID;
  demo_user UUID;
BEGIN
  -- Get template and user IDs
  SELECT id INTO data_analysis_template FROM workflow_templates WHERE template_key = 'data-analysis';
  SELECT id INTO decision_making_template FROM workflow_templates WHERE template_key = 'decision-making';
  SELECT id INTO content_creation_template FROM workflow_templates WHERE template_key = 'content-creation';
  SELECT id INTO admin_user FROM users WHERE username = 'admin';
  SELECT id INTO demo_user FROM users WHERE username = 'demo_user';

  -- Insert sample workflows
  INSERT INTO workflows (id, template_id, template_key, title, description, status, context, created_by) VALUES
    (
      uuid_generate_v4(),
      data_analysis_template,
      'data-analysis',
      'Sales Data Analysis Q4 2024',
      'Analyze quarterly sales performance and identify trends',
      'completed',
      '{
        "data_source": "sales_database",
        "time_period": "Q4_2024",
        "metrics": ["revenue", "growth", "customer_acquisition"],
        "focus_areas": ["regional_performance", "product_categories"]
      }',
      admin_user
    ),
    (
      uuid_generate_v4(),
      decision_making_template,
      'decision-making',
      'Feature Prioritization',
      'Decide on next feature priorities for product roadmap',
      'waiting_for_human',
      '{
        "product": "GUI-LOP Platform",
        "constraints": ["budget_limit", "technical_complexity", "user_demand"],
        "timeline": "Q1_2025",
        "stakeholders": ["engineering", "product", "sales"]
      }',
      demo_user
    ),
    (
      uuid_generate_v4(),
      content_creation_template,
      'content-creation',
      'Documentation Update',
      'Update API documentation with new endpoints',
      'running',
      '{
        "content_type": "api_documentation",
        "target_audience": "developers",
        "endpoints_to_document": ["workflows", "sessions", "events"],
        "format": "markdown"
      }',
      admin_user
    )
  ON CONFLICT DO NOTHING;
END $$;

-- Enable audit triggers for key tables
-- Uncomment these lines to enable full audit logging
-- CREATE TRIGGER audit_users_trigger AFTER INSERT OR UPDATE OR DELETE ON users
--     FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();
--
-- CREATE TRIGGER audit_workflows_trigger AFTER INSERT OR UPDATE OR DELETE ON workflows
--     FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();
--
-- CREATE TRIGGER audit_workflow_steps_trigger AFTER INSERT OR UPDATE OR DELETE ON workflow_steps
--     FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();
--
-- CREATE TRIGGER audit_human_responses_trigger AFTER INSERT OR UPDATE OR DELETE ON human_responses
--     FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

-- Create sample events for demonstration
DO $$
DECLARE
  sample_workflow UUID;
BEGIN
  -- Get a sample workflow ID
  SELECT id INTO sample_workflow FROM workflows WHERE title = 'Sales Data Analysis Q4 2024' LIMIT 1;

  IF sample_workflow IS NOT NULL THEN
    INSERT INTO events (event_type, workflow_id, event_data) VALUES
      ('workflow_created', sample_workflow, '{"initiator": "admin", "source": "web_interface"}'),
      ('workflow_started', sample_workflow, '{"initiator": "admin", "timestamp": "2024-01-15T10:00:00Z"}'),
      ('ui_generated', sample_workflow, '{"ui_components": ["dashboard", "charts"], "ui_url": "http://localhost:8501/abc123"}'),
      ('human_response', sample_workflow, '{"action": "approve", "confidence": 0.95, "feedback": "Analysis looks comprehensive"}'),
      ('workflow_completed', sample_workflow, '{"duration_minutes": 25, "success": true}');
  END IF;
END $$;

-- Output summary
DO $$
DECLARE
  user_count INTEGER;
  workflow_count INTEGER;
  template_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO user_count FROM users;
  SELECT COUNT(*) INTO workflow_count FROM workflows;
  SELECT COUNT(*) INTO template_count FROM workflow_templates;

  RAISE NOTICE '🌱 Database seeding completed!';
  RAISE NOTICE '   Users created: %', user_count;
  RAISE NOTICE '   Workflow templates: %', template_count;
  RAISE NOTICE '   Sample workflows: %', workflow_count;
  RAISE NOTICE '';
  RAISE NOTICE '📝 Default login credentials:';
  RAISE NOTICE '   Admin: admin@gui-lop.com / admin123';
  RAISE NOTICE '   Demo: demo@gui-lop.com / demo123';
  RAISE NOTICE '';
  RAISE NOTICE '⚠️  Remember to change default passwords in production!';
END $$;