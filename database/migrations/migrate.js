#!/usr/bin/env node

/**
 * Database Migration Runner
 * Handles execution of database migrations with proper error handling and rollback capabilities
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { db, dbHelpers } from '../config/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MIGRATIONS_TABLE = 'schema_migrations';
const MIGRATIONS_DIR = path.join(__dirname);

class MigrationRunner {
  constructor() {
    this.db = db;
    this.migrations = [];
  }

  /**
   * Initialize migrations table
   */
  async initialize() {
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
          id SERIAL PRIMARY KEY,
          filename VARCHAR(255) UNIQUE NOT NULL,
          checksum VARCHAR(64) NOT NULL,
          executed_at TIMESTAMPTZ DEFAULT NOW(),
          execution_time_ms INTEGER
        );
      `);

      console.log('✓ Migrations table initialized');
    } catch (error) {
      console.error('Failed to initialize migrations table:', error);
      throw error;
    }
  }

  /**
   * Load migration files from the migrations directory
   */
  async loadMigrations() {
    try {
      const files = await fs.readdir(MIGRATIONS_DIR);
      const migrationFiles = files
        .filter(file => file.endsWith('.sql') && file !== 'migrate.js')
        .sort();

      this.migrations = await Promise.all(
        migrationFiles.map(async (filename) => {
          const filePath = path.join(MIGRATIONS_DIR, filename);
          const content = await fs.readFile(filePath, 'utf8');
          const checksum = this.calculateChecksum(content);

          return {
            filename,
            content,
            checksum,
            path: filePath
          };
        })
      );

      console.log(`✓ Loaded ${this.migrations.length} migration files`);
    } catch (error) {
      console.error('Failed to load migrations:', error);
      throw error;
    }
  }

  /**
   * Calculate checksum for migration content
   */
  calculateChecksum(content) {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * Get executed migrations from database
   */
  async getExecutedMigrations() {
    try {
      const result = await db.query(`
        SELECT filename, checksum, executed_at
        FROM ${MIGRATIONS_TABLE}
        ORDER BY executed_at
      `);

      return result.rows;
    } catch (error) {
      console.error('Failed to get executed migrations:', error);
      throw error;
    }
  }

  /**
   * Get pending migrations
   */
  async getPendingMigrations() {
    const executed = await this.getExecutedMigrations();
    const executedFilenames = new Set(executed.map(m => m.filename));

    return this.migrations.filter(migration => {
      const executedMigration = executed.find(e => e.filename === migration.filename);

      if (!executedMigration) {
        return true; // Not executed yet
      }

      // Check if the migration has been modified since execution
      if (executedMigration.checksum !== migration.checksum) {
        console.warn(`⚠️  Migration ${migration.filename} has been modified since execution`);
        return false;
      }

      return false;
    });
  }

  /**
   * Execute a single migration
   */
  async executeMigration(migration) {
    const startTime = Date.now();

    try {
      console.log(`⬆️  Executing migration: ${migration.filename}`);

      // Start transaction
      await db.transaction(async (client) => {
        // Split migration content into individual statements
        const statements = migration.content
          .split(';')
          .map(stmt => stmt.trim())
          .filter(stmt => stmt && !stmt.startsWith('--'));

        // Execute each statement
        for (const statement of statements) {
          if (statement.trim()) {
            await client.query(statement);
          }
        }

        // Record migration execution
        const executionTime = Date.now() - startTime;
        await client.query(`
          INSERT INTO ${MIGRATIONS_TABLE} (filename, checksum, execution_time_ms)
          VALUES ($1, $2, $3)
        `, [migration.filename, migration.checksum, executionTime]);
      });

      const executionTime = Date.now() - startTime;
      console.log(`✅ Migration ${migration.filename} executed successfully (${executionTime}ms)`);

      return true;
    } catch (error) {
      const executionTime = Date.now() - startTime;
      console.error(`❌ Migration ${migration.filename} failed after ${executionTime}ms:`, error);
      throw error;
    }
  }

  /**
   * Run all pending migrations
   */
  async migrate() {
    try {
      console.log('🚀 Starting database migration...\n');

      await this.initialize();
      await this.loadMigrations();

      const pending = await this.getPendingMigrations();

      if (pending.length === 0) {
        console.log('✅ No pending migrations. Database is up to date.');
        return { success: true, executed: 0 };
      }

      console.log(`📋 Found ${pending.length} pending migrations:`);
      pending.forEach(m => console.log(`   - ${m.filename}`));
      console.log();

      let executedCount = 0;

      for (const migration of pending) {
        await this.executeMigration(migration);
        executedCount++;
      }

      console.log(`\n🎉 Migration completed successfully! Executed ${executedCount} migrations.`);

      return { success: true, executed: executedCount };
    } catch (error) {
      console.error('\n💥 Migration failed:', error.message);
      return { success: false, error: error.message, executed: 0 };
    }
  }

  /**
   * Get migration status
   */
  async status() {
    try {
      await this.initialize();
      await this.loadMigrations();

      const executed = await this.getExecutedMigrations();
      const pending = await this.getPendingMigrations();

      console.log('\n📊 Migration Status:');
      console.log(`   Total migrations: ${this.migrations.length}`);
      console.log(`   Executed: ${executed.length}`);
      console.log(`   Pending: ${pending.length}`);

      if (executed.length > 0) {
        console.log('\n✅ Executed migrations:');
        executed.forEach(m => {
          console.log(`   - ${m.filename} (${m.executed_at})`);
        });
      }

      if (pending.length > 0) {
        console.log('\n⏳ Pending migrations:');
        pending.forEach(m => {
          console.log(`   - ${m.filename}`);
        });
      }

      return {
        total: this.migrations.length,
        executed: executed.length,
        pending: pending.length,
        executedMigrations: executed,
        pendingMigrations: pending
      };
    } catch (error) {
      console.error('Failed to get migration status:', error);
      throw error;
    }
  }

  /**
   * Create a new migration file
   */
  async create(name) {
    const timestamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0];
    const filename = `${timestamp}_${name.replace(/[^a-zA-Z0-9_]/g, '_')}.sql`;
    const filePath = path.join(MIGRATIONS_DIR, filename);

    const template = `-- Migration: ${name}
-- Created: ${new Date().toISOString()}
-- Description: ${name}

-- Add your migration SQL here
-- Example:
-- CREATE TABLE example (
--   id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
--   created_at TIMESTAMPTZ DEFAULT NOW()
-- );
`;

    await fs.writeFile(filePath, template);
    console.log(`✅ Migration file created: ${filename}`);

    return filename;
  }
}

// CLI interface
async function main() {
  const command = process.argv[2];
  const migrationRunner = new MigrationRunner();

  // Ensure database is connected
  await migrationRunner.db.initialize();

  switch (command) {
    case 'migrate':
    case 'up':
      await migrationRunner.migrate();
      break;

    case 'status':
      await migrationRunner.status();
      break;

    case 'create':
      const name = process.argv[3];
      if (!name) {
        console.error('❌ Migration name is required');
        console.log('Usage: node migrate.js create <migration_name>');
        process.exit(1);
      }
      await migrationRunner.create(name);
      break;

    default:
      console.log('🗄️  Database Migration Tool');
      console.log('');
      console.log('Usage:');
      console.log('  node migrate.js migrate      # Run all pending migrations');
      console.log('  node migrate.js up           # Alias for migrate');
      console.log('  node migrate.js status       # Show migration status');
      console.log('  node migrate.js create <name> # Create new migration file');
      console.log('');
      console.log('Examples:');
      console.log('  node migrate.js migrate');
      console.log('  node migrate.js create add_user_profiles');
      break;
  }

  // Close database connection
  await migrationRunner.db.close();
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('Migration failed:', error);
    process.exit(1);
  });
}

export { MigrationRunner };
export default migrationRunner;