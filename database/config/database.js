/**
 * Database Connection and Pooling Configuration
 * PostgreSQL connection management for GUI-LOP platform
 */

import pkg from 'pg';
import dotenv from 'dotenv';

const { Pool } = pkg;

// Load environment variables
dotenv.config();

// Database configuration
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'gui_lop',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  ssl: process.env.DB_SSL === 'true' ? {
    rejectUnauthorized: false
  } : false,
  max: parseInt(process.env.DB_POOL_MAX) || 20, // Maximum number of connections in pool
  min: parseInt(process.env.DB_POOL_MIN) || 2,   // Minimum number of connections in pool
  idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT) || 30000, // How long a client is allowed to remain idle before being closed
  connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT) || 2000, // How long to wait when connecting a new client
  acquireTimeoutMillis: parseInt(process.env.DB_ACQUIRE_TIMEOUT) || 60000, // How long to wait when acquiring a client from the pool
  createTimeoutMillis: parseInt(process.env.DB_CREATE_TIMEOUT) || 30000, // How long to wait when creating a new client
  destroyTimeoutMillis: parseInt(process.env.DB_DESTROY_TIMEOUT) || 5000, // How long to wait when destroying a client
  reapIntervalMillis: parseInt(process.env.DB_REAP_INTERVAL) || 1000, // How often to check for idle clients
  createRetryIntervalMillis: parseInt(process.env.DB_RETRY_INTERVAL) || 200 // // How long to wait between attempts to create a new client
};

// Create connection pool
const pool = new Pool(dbConfig);

// Connection event listeners
pool.on('connect', (client) => {
  console.log('New database client connected');
});

pool.on('acquire', (client) => {
  console.log('Database client acquired from pool');
});

pool.on('remove', (client) => {
  console.log('Database client removed from pool');
});

pool.on('error', (err, client) => {
  console.error('Unexpected error on idle client', err);
  console.error('Client details:', {
    pid: client.processID,
    query: client.query,
    state: client.state
  });
});

/**
 * Database connection class with enhanced functionality
 */
class DatabaseConnection {
  constructor() {
    this.pool = pool;
    this.connected = false;
  }

  /**
   * Initialize database connection
   */
  async initialize() {
    try {
      // Test the connection
      const client = await this.pool.connect();
      const result = await client.query('SELECT NOW() as current_time, version() as version');
      client.release();

      this.connected = true;
      console.log('Database connected successfully');
      console.log('Database time:', result.rows[0].current_time);
      console.log('PostgreSQL version:', result.rows[0].version.split(' ')[0]);

      return true;
    } catch (error) {
      console.error('Failed to connect to database:', error);
      this.connected = false;
      throw error;
    }
  }

  /**
   * Get a client from the pool
   */
  async getClient() {
    if (!this.connected) {
      throw new Error('Database not connected. Call initialize() first.');
    }
    return await this.pool.connect();
  }

  /**
   * Execute a query with automatic client management
   */
  async query(text, params = []) {
    const start = Date.now();

    try {
      const client = await this.pool.connect();
      const result = await client.query(text, params);
      client.release();

      const duration = Date.now() - start;

      // Log slow queries
      if (duration > 1000) {
        console.warn(`Slow query detected (${duration}ms):`, text.substring(0, 100));
      }

      return result;
    } catch (error) {
      console.error('Query execution failed:', {
        query: text.substring(0, 100),
        params: params.length > 0 ? '[REDACTED]' : [],
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Execute a transaction
   */
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

  /**
   * Health check
   */
  async healthCheck() {
    try {
      const result = await this.query(`
        SELECT
          'healthy' as status,
          NOW() as timestamp,
          version() as version,
          (SELECT count(*) FROM pg_stat_activity WHERE state = 'active') as active_connections
      `);

      return {
        status: result.rows[0].status,
        timestamp: result.rows[0].timestamp,
        version: result.rows[0].version,
        activeConnections: parseInt(result.rows[0].active_connections),
        poolStats: {
          totalCount: this.pool.totalCount,
          idleCount: this.pool.idleCount,
          waitingCount: this.pool.waitingCount
        }
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: error.message
      };
    }
  }

  /**
   * Close all connections in the pool
   */
  async close() {
    try {
      await this.pool.end();
      this.connected = false;
      console.log('Database connection pool closed');
    } catch (error) {
      console.error('Error closing database pool:', error);
      throw error;
    }
  }

  /**
   * Get pool statistics
   */
  getPoolStats() {
    return {
      totalCount: this.pool.totalCount,
      idleCount: this.pool.idleCount,
      waitingCount: this.pool.waitingCount,
      connected: this.connected
    };
  }
}

// Create singleton instance
const db = new DatabaseConnection();

/**
 * Database helper functions
 */
const dbHelpers = {
  /**
   * Execute parameterized query safely
   */
  async safeQuery(text, params = []) {
    if (!Array.isArray(params)) {
      throw new Error('Parameters must be an array');
    }

    // Validate parameter count matches query placeholders
    const placeholderCount = (text.match(/\$/g) || []).length;
    if (placeholderCount !== params.length) {
      throw new Error(`Parameter count mismatch: expected ${placeholderCount}, got ${params.length}`);
    }

    return await db.query(text, params);
  },

  /**
   * Insert a record and return the inserted row
   */
  async insert(tableName, data) {
    const columns = Object.keys(data);
    const values = Object.values(data);
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');

    const query = `
      INSERT INTO ${tableName} (${columns.join(', ')})
      VALUES (${placeholders})
      RETURNING *
    `;

    const result = await this.safeQuery(query, values);
    return result.rows[0];
  },

  /**
   * Update a record and return the updated row
   */
  async update(tableName, id, data) {
    const columns = Object.keys(data);
    const values = Object.values(data);
    const setClause = columns.map((col, index) => `${col} = $${index + 2}`).join(', ');

    const query = `
      UPDATE ${tableName}
      SET ${setClause}, updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `;

    const result = await this.safeQuery(query, [id, ...values]);
    return result.rows[0];
  },

  /**
   * Delete a record by ID
   */
  async delete(tableName, id) {
    const query = `DELETE FROM ${tableName} WHERE id = $1 RETURNING *`;
    const result = await this.safeQuery(query, [id]);
    return result.rows[0];
  },

  /**
   * Find a record by ID
   */
  async findById(tableName, id) {
    const query = `SELECT * FROM ${tableName} WHERE id = $1`;
    const result = await this.safeQuery(query, [id]);
    return result.rows[0] || null;
  },

  /**
   * Find records with optional filters
   */
  async find(tableName, filters = {}, options = {}) {
    const { limit = 50, offset = 0, orderBy = 'created_at', order = 'DESC' } = options;

    let query = `SELECT * FROM ${tableName}`;
    const params = [];
    let paramIndex = 1;

    if (Object.keys(filters).length > 0) {
      const whereClause = Object.entries(filters)
        .map(([key, value]) => {
          params.push(value);
          return `${key} = $${paramIndex++}`;
        })
        .join(' AND ');
      query += ` WHERE ${whereClause}`;
    }

    query += ` ORDER BY ${orderBy} ${order} LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
    params.push(limit, offset);

    const result = await this.safeQuery(query, params);
    return result.rows;
  },

  /**
   * Count records with optional filters
   */
  async count(tableName, filters = {}) {
    let query = `SELECT COUNT(*) as count FROM ${tableName}`;
    const params = [];
    let paramIndex = 1;

    if (Object.keys(filters).length > 0) {
      const whereClause = Object.entries(filters)
        .map(([key, value]) => {
          params.push(value);
          return `${key} = $${paramIndex++}`;
        })
        .join(' AND ');
      query += ` WHERE ${whereClause}`;
    }

    const result = await this.safeQuery(query, params);
    return parseInt(result.rows[0].count);
  },

  /**
   * Check if a record exists
   */
  async exists(tableName, filters = {}) {
    const count = await this.count(tableName, filters);
    return count > 0;
  }
};

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing database connections...');
  await db.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, closing database connections...');
  await db.close();
  process.exit(0);
});

export { db, dbHelpers };
export default db;