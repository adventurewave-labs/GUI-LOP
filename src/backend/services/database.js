/**
 * Database Service
 * Handles PostgreSQL database operations for GUI-LOP
 */

import pg from 'pg';

class DatabaseService {
  constructor() {
    this.pool = null;
    this.config = {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT) || 5432,
      database: process.env.DB_NAME || 'gui_lop',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || '',
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    };
  }

  async connect() {
    try {
      this.pool = new pg.Pool(this.config);

      // Test the connection
      const client = await this.pool.connect();
      await client.query('SELECT NOW()');
      client.release();

      console.log('Database connected successfully');
      await this.initializeTables();
    } catch (error) {
      console.error('Database connection error:', error);
      throw error;
    }
  }

  async disconnect() {
    if (this.pool) {
      await this.pool.end();
      console.log('Database disconnected');
    }
  }

  async initializeTables() {
    try {
      // Create tables if they don't exist
      await this.createTables();
      console.log('Database tables initialized');
    } catch (error) {
      console.error('Error initializing tables:', error);
      throw error;
    }
  }

  async createTables() {
    const createTablesSQL = `
      -- Sessions table
      CREATE TABLE IF NOT EXISTS sessions (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL,
        metadata JSONB DEFAULT '{}',
        status VARCHAR(20) DEFAULT 'active',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        last_activity TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        expires_at TIMESTAMP WITH TIME ZONE
      );

      -- Workflows table
      CREATE TABLE IF NOT EXISTS workflows (
        id UUID PRIMARY KEY,
        template_id VARCHAR(50) NOT NULL,
        session_id UUID NOT NULL REFERENCES sessions(id),
        state JSONB NOT NULL DEFAULT '{}',
        status VARCHAR(20) DEFAULT 'created',
        error TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        completed_at TIMESTAMP WITH TIME ZONE,
        cancelled_at TIMESTAMP WITH TIME ZONE,
        cancelled_by TEXT,
        cancellation_reason TEXT
      );

      -- Events table
      CREATE TABLE IF NOT EXISTS events (
        id VARCHAR(100) PRIMARY KEY,
        type VARCHAR(50) NOT NULL,
        session_id UUID NOT NULL REFERENCES sessions(id),
        workflow_id UUID REFERENCES workflows(id),
        data JSONB NOT NULL DEFAULT '{}',
        priority VARCHAR(20) DEFAULT 'medium',
        source VARCHAR(20) DEFAULT 'agent',
        timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        processed BOOLEAN DEFAULT FALSE,
        original_event_id VARCHAR(100)
      );

      -- API keys table
      CREATE TABLE IF NOT EXISTS api_keys (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        key_hash VARCHAR(255) NOT NULL UNIQUE,
        name VARCHAR(100) NOT NULL,
        description TEXT,
        user_id UUID NOT NULL,
        permissions JSONB DEFAULT '[]',
        active BOOLEAN DEFAULT TRUE,
        expires_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        last_used TIMESTAMP WITH TIME ZONE
      );

      -- Data display logs table
      CREATE TABLE IF NOT EXISTS data_display_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id UUID NOT NULL REFERENCES sessions(id),
        workflow_id UUID REFERENCES workflows(id),
        display_type VARCHAR(50) NOT NULL,
        data_size INTEGER NOT NULL,
        metadata JSONB DEFAULT '{}',
        timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      -- Workflow history table
      CREATE TABLE IF NOT EXISTS workflow_history (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        workflow_id UUID NOT NULL REFERENCES workflows(id),
        node_name VARCHAR(100) NOT NULL,
        action VARCHAR(50) NOT NULL,
        state_before JSONB,
        state_after JSONB,
        duration_ms INTEGER,
        error_message TEXT,
        timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      -- User interactions table
      CREATE TABLE IF NOT EXISTS user_interactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id UUID NOT NULL REFERENCES sessions(id),
        workflow_id UUID REFERENCES workflows(id),
        event_id VARCHAR(100) REFERENCES events(id),
        interaction_type VARCHAR(50) NOT NULL,
        interaction_data JSONB DEFAULT '{}',
        user_id UUID,
        timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      -- Create indexes
      CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
      CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

      CREATE INDEX IF NOT EXISTS idx_workflows_session_id ON workflows(session_id);
      CREATE INDEX IF NOT EXISTS idx_workflows_template_id ON workflows(template_id);
      CREATE INDEX IF NOT EXISTS idx_workflows_status ON workflows(status);
      CREATE INDEX IF NOT EXISTS idx_workflows_created_at ON workflows(created_at);

      CREATE INDEX IF NOT EXISTS idx_events_session_id ON events(session_id);
      CREATE INDEX IF NOT EXISTS idx_events_workflow_id ON events(workflow_id);
      CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
      CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
      CREATE INDEX IF NOT EXISTS idx_events_processed ON events(processed);

      CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);
      CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(active);

      CREATE INDEX IF NOT EXISTS idx_data_display_logs_session_id ON data_display_logs(session_id);
      CREATE INDEX IF NOT EXISTS idx_data_display_logs_workflow_id ON data_display_logs(workflow_id);

      CREATE INDEX IF NOT EXISTS idx_workflow_history_workflow_id ON workflow_history(workflow_id);
      CREATE INDEX IF NOT EXISTS idx_workflow_history_timestamp ON workflow_history(timestamp);

      CREATE INDEX IF NOT EXISTS idx_user_interactions_session_id ON user_interactions(session_id);
      CREATE INDEX IF NOT EXISTS idx_user_interactions_workflow_id ON user_interactions(workflow_id);
      CREATE INDEX IF NOT EXISTS idx_user_interactions_timestamp ON user_interactions(timestamp);
    `;

    await this.query(createTablesSQL);
  }

  // Generic query method
  async query(text, params = []) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(text, params);
      return result;
    } finally {
      client.release();
    }
  }

  // Transaction method
  async transaction(callback) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // Session operations
  async createSession(sessionData) {
    const { id, user_id, metadata, expires_at, status } = sessionData;
    const sql = `
      INSERT INTO sessions (id, user_id, metadata, expires_at, status)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;
    const result = await this.query(sql, [id, user_id, metadata, expires_at, status]);
    return result.rows[0];
  }

  async getSession(sessionId) {
    const sql = 'SELECT * FROM sessions WHERE id = $1';
    const result = await this.query(sql, [sessionId]);
    return result.rows[0] || null;
  }

  async updateSessionActivity(sessionId) {
    const sql = `
      UPDATE sessions
      SET last_activity = NOW()
      WHERE id = $1
      RETURNING *
    `;
    const result = await this.query(sql, [sessionId]);
    return result.rows[0];
  }

  async deleteSession(sessionId) {
    const sql = 'DELETE FROM sessions WHERE id = $1';
    await this.query(sql, [sessionId]);
  }

  // Workflow operations
  async createWorkflow(workflowData) {
    const { id, template_id, session_id, state, status } = workflowData;
    const sql = `
      INSERT INTO workflows (id, template_id, session_id, state, status)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;
    const result = await this.query(sql, [id, template_id, session_id, state, status]);
    return result.rows[0];
  }

  async getWorkflow(workflowId) {
    const sql = 'SELECT * FROM workflows WHERE id = $1';
    const result = await this.query(sql, [workflowId]);
    return result.rows[0] || null;
  }

  async getWorkflows(filters = {}) {
    let sql = 'SELECT * FROM workflows WHERE 1=1';
    const params = [];
    let paramIndex = 1;

    if (filters.session_id) {
      sql += ` AND session_id = $${paramIndex++}`;
      params.push(filters.session_id);
    }

    if (filters.template_id) {
      sql += ` AND template_id = $${paramIndex++}`;
      params.push(filters.template_id);
    }

    if (filters.status) {
      sql += ` AND status = $${paramIndex++}`;
      params.push(filters.status);
    }

    sql += ' ORDER BY created_at DESC';

    if (filters.limit) {
      sql += ` LIMIT $${paramIndex++}`;
      params.push(filters.limit);
    }

    if (filters.offset) {
      sql += ` OFFSET $${paramIndex++}`;
      params.push(filters.offset);
    }

    const result = await this.query(sql, params);
    return result.rows;
  }

  async updateWorkflow(workflowId, updates) {
    const fields = Object.keys(updates);
    const values = Object.values(updates);
    const setClause = fields.map((field, index) => `${field} = $${index + 2}`).join(', ');

    const sql = `
      UPDATE workflows
      SET ${setClause}, updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `;
    const result = await this.query(sql, [workflowId, ...values]);
    return result.rows[0];
  }

  async updateWorkflowStatus(workflowId, status) {
    const sql = `
      UPDATE workflows
      SET status = $2, updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `;
    const result = await this.query(sql, [workflowId, status]);
    return result.rows[0];
  }

  async deleteWorkflow(workflowId) {
    const sql = 'DELETE FROM workflows WHERE id = $1';
    await this.query(sql, [workflowId]);
  }

  // Event operations
  async createEvent(eventData) {
    const { id, type, session_id, workflow_id, data, priority, source, original_event_id } = eventData;
    const sql = `
      INSERT INTO events (id, type, session_id, workflow_id, data, priority, source, original_event_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;
    const result = await this.query(sql, [id, type, session_id, workflow_id, data, priority, source, original_event_id]);
    return result.rows[0];
  }

  async getEvent(eventId) {
    const sql = 'SELECT * FROM events WHERE id = $1';
    const result = await this.query(sql, [eventId]);
    return result.rows[0] || null;
  }

  async getEvents(filters = {}) {
    let sql = 'SELECT * FROM events WHERE 1=1';
    const params = [];
    let paramIndex = 1;

    if (filters.session_id) {
      sql += ` AND session_id = $${paramIndex++}`;
      params.push(filters.session_id);
    }

    if (filters.workflow_id) {
      sql += ` AND workflow_id = $${paramIndex++}`;
      params.push(filters.workflow_id);
    }

    if (filters.type) {
      sql += ` AND type = $${paramIndex++}`;
      params.push(filters.type);
    }

    sql += ' ORDER BY timestamp DESC';

    if (filters.limit) {
      sql += ` LIMIT $${paramIndex++}`;
      params.push(filters.limit);
    }

    if (filters.offset) {
      sql += ` OFFSET $${paramIndex++}`;
      params.push(filters.offset);
    }

    const result = await this.query(sql, params);
    return result.rows;
  }

  async deleteEvent(eventId) {
    const sql = 'DELETE FROM events WHERE id = $1';
    await this.query(sql, [eventId]);
  }

  async getEventSummary(sessionId) {
    const sql = `
      SELECT
        type,
        COUNT(*) as count,
        MAX(timestamp) as last_occurrence
      FROM events
      WHERE session_id = $1
      GROUP BY type
      ORDER BY count DESC
    `;
    const result = await this.query(sql, [sessionId]);
    return result.rows;
  }

  // API key operations
  async createApiKey(keyData) {
    const { key_hash, name, description, user_id, permissions, expires_at } = keyData;
    const sql = `
      INSERT INTO api_keys (key_hash, name, description, user_id, permissions, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;
    const result = await this.query(sql, [key_hash, name, description, user_id, permissions, expires_at]);
    return result.rows[0];
  }

  async getApiKey(keyHash) {
    const sql = 'SELECT * FROM api_keys WHERE key_hash = $1 AND active = TRUE';
    const result = await this.query(sql, [keyHash]);
    return result.rows[0] || null;
  }

  async updateApiKeyLastUsed(keyId) {
    const sql = 'UPDATE api_keys SET last_used = NOW() WHERE id = $1';
    await this.query(sql, [keyId]);
  }

  // Data display log operations
  async createDataDisplayLog(logData) {
    const { session_id, workflow_id, display_type, data_size, metadata } = logData;
    const sql = `
      INSERT INTO data_display_logs (session_id, workflow_id, display_type, data_size, metadata)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;
    const result = await this.query(sql, [session_id, workflow_id, display_type, data_size, metadata]);
    return result.rows[0];
  }

  // Workflow history operations
  async createWorkflowHistory(historyData) {
    const { workflow_id, node_name, action, state_before, state_after, duration_ms, error_message } = historyData;
    const sql = `
      INSERT INTO workflow_history (workflow_id, node_name, action, state_before, state_after, duration_ms, error_message)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;
    const result = await this.query(sql, [workflow_id, node_name, action, state_before, state_after, duration_ms, error_message]);
    return result.rows[0];
  }

  async getWorkflowHistory(workflowId, limit = 100) {
    const sql = `
      SELECT * FROM workflow_history
      WHERE workflow_id = $1
      ORDER BY timestamp DESC
      LIMIT $2
    `;
    const result = await this.query(sql, [workflowId, limit]);
    return result.rows;
  }

  // User interaction operations
  async createUserInteraction(interactionData) {
    const { session_id, workflow_id, event_id, interaction_type, interaction_data, user_id } = interactionData;
    const sql = `
      INSERT INTO user_interactions (session_id, workflow_id, event_id, interaction_type, interaction_data, user_id)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;
    const result = await this.query(sql, [session_id, workflow_id, event_id, interaction_type, interaction_data, user_id]);
    return result.rows[0];
  }

  // Statistics and analytics
  async getSessionStats(sessionId) {
    const sql = `
      SELECT
        COUNT(*) as total_events,
        COUNT(CASE WHEN processed = TRUE THEN 1 END) as processed_events,
        COUNT(DISTINCT workflow_id) as workflow_count,
        MAX(timestamp) as last_activity
      FROM events
      WHERE session_id = $1
    `;
    const result = await this.query(sql, [sessionId]);
    const stats = result.rows[0];

    // Get events by type
    const typesSql = `
      SELECT type, COUNT(*) as count
      FROM events
      WHERE session_id = $1
      GROUP BY type
    `;
    const typesResult = await this.query(typesSql, [sessionId]);

    return {
      ...stats,
      events_by_type: typesResult.rows.reduce((acc, row) => {
        acc[row.type] = parseInt(row.count);
        return acc;
      }, {}),
    };
  }

  async getDatabaseStats() {
    const sql = `
      SELECT
        (SELECT COUNT(*) FROM sessions WHERE status = 'active') as active_sessions,
        (SELECT COUNT(*) FROM workflows WHERE status = 'running') as running_workflows,
        (SELECT COUNT(*) FROM events WHERE timestamp > NOW() - INTERVAL '1 hour') as events_last_hour,
        (SELECT COUNT(*) FROM api_keys WHERE active = TRUE) as active_api_keys
    `;
    const result = await this.query(sql);
    return result.rows[0];
  }
}

export default DatabaseService;