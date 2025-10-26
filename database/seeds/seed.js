#!/usr/bin/env node

/**
 * Database Seeding Script
 * Populates the database with initial data for development and production
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { db } from '../config/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SEEDS_DIR = path.join(__dirname);

class SeedRunner {
  constructor() {
    this.db = db;
    this.seeds = [];
  }

  /**
   * Load seed files from the seeds directory
   */
  async loadSeeds() {
    try {
      const files = await fs.readdir(SEEDS_DIR);
      const seedFiles = files
        .filter(file => file.endsWith('.sql') && file !== 'seed.js')
        .sort();

      this.seeds = await Promise.all(
        seedFiles.map(async (filename) => {
          const filePath = path.join(SEEDS_DIR, filename);
          const content = await fs.readFile(filePath, 'utf8');

          return {
            filename,
            content,
            path: filePath
          };
        })
      );

      console.log(`✓ Loaded ${this.seeds.length} seed files`);
    } catch (error) {
      console.error('Failed to load seeds:', error);
      throw error;
    }
  }

  /**
   * Execute a single seed file
   */
  async executeSeed(seed) {
    const startTime = Date.now();

    try {
      console.log(`🌱 Executing seed: ${seed.filename}`);

      // Start transaction
      await this.db.transaction(async (client) => {
        // Split seed content into individual statements
        const statements = seed.content
          .split(';')
          .map(stmt => stmt.trim())
          .filter(stmt => stmt && !stmt.startsWith('--') && !stmt.startsWith('DO $'));

        // Execute each statement
        for (const statement of statements) {
          if (statement.trim()) {
            await client.query(statement);
          }
        }

        // Execute DO blocks separately
        const doBlocks = seed.content.match(/DO \$\$.*?END \$\$/gs) || [];
        for (const doBlock of doBlocks) {
          await client.query(doBlock);
        }
      });

      const executionTime = Date.now() - startTime;
      console.log(`✅ Seed ${seed.filename} executed successfully (${executionTime}ms)`);

      return true;
    } catch (error) {
      const executionTime = Date.now() - startTime;
      console.error(`❌ Seed ${seed.filename} failed after ${executionTime}ms:`, error);
      throw error;
    }
  }

  /**
   * Run all seed files
   */
  async seed(options = {}) {
    const { force = false, files = [] } = options;

    try {
      console.log('🚀 Starting database seeding...\n');

      await this.loadSeeds();

      let seedsToRun = this.seeds;

      if (files.length > 0) {
        // Run specific seed files
        seedsToRun = this.seeds.filter(seed => files.includes(seed.filename));
        if (seedsToRun.length === 0) {
          console.error('❌ No matching seed files found');
          return { success: false, error: 'No matching seed files found' };
        }
      }

      if (!force) {
        // Check if seeds have already been run (optional check)
        try {
          const userCount = await this.db.query('SELECT COUNT(*) as count FROM users');
          if (parseInt(userCount.rows[0].count) > 0 && !force) {
            console.log('⚠️  Database appears to be seeded. Use --force to reseed.');
            console.log('   Current users:', userCount.rows[0].count);

            if (!files.length) {
              return { success: true, message: 'Database already seeded', skipped: true };
            }
          }
        } catch (error) {
          // Table might not exist yet, continue with seeding
        }
      }

      console.log(`📋 Executing ${seedsToRun.length} seed files:`);
      seedsToRun.forEach(s => console.log(`   - ${s.filename}`));
      console.log();

      let executedCount = 0;

      for (const seed of seedsToRun) {
        await this.executeSeed(seed);
        executedCount++;
      }

      console.log(`\n🎉 Seeding completed successfully! Executed ${executedCount} seed files.`);

      // Show summary
      await this.showSummary();

      return { success: true, executed: executedCount };
    } catch (error) {
      console.error('\n💥 Seeding failed:', error.message);
      return { success: false, error: error.message, executed: 0 };
    }
  }

  /**
   * Show database summary after seeding
   */
  async showSummary() {
    try {
      console.log('\n📊 Database Summary:');

      // Count records in key tables
      const tables = [
        { name: 'users', description: 'Users' },
        { name: 'roles', description: 'Roles' },
        { name: 'workflow_templates', description: 'Workflow Templates' },
        { name: 'workflows', description: 'Workflows' },
        { name: 'user_sessions', description: 'Active Sessions' },
        { name: 'events', description: 'Events' }
      ];

      for (const table of tables) {
        try {
          const result = await this.db.query(`SELECT COUNT(*) as count FROM ${table.name}`);
          const count = result.rows[0].count;
          console.log(`   ${table.description}: ${count}`);
        } catch (error) {
          console.log(`   ${table.description}: N/A (table doesn't exist)`);
        }
      }

      // Show workflow status breakdown
      try {
        const statusResult = await this.db.query(`
          SELECT status, COUNT(*) as count
          FROM workflows
          GROUP BY status
        `);

        if (statusResult.rows.length > 0) {
          console.log('   Workflow Status:');
          statusResult.rows.forEach(row => {
            console.log(`     ${row.status}: ${row.count}`);
          });
        }
      } catch (error) {
        // Workflows table might not exist
      }

    } catch (error) {
      console.log('   Unable to generate summary:', error.message);
    }
  }

  /**
   * Reset database (drop and recreate all data)
   */
  async reset() {
    try {
      console.log('🗑️  Resetting database...');

      // This is a dangerous operation, so we'll be explicit about what we're doing
      const tables = [
        'events',
        'audit_logs',
        'human_responses',
        'workflow_steps',
        'workflow_metrics',
        'api_keys',
        'workflows',
        'workflow_templates',
        'user_sessions',
        'users',
        'roles',
        'system_config'
      ];

      await this.db.transaction(async (client) => {
        for (const table of tables) {
          try {
            await client.query(`DELETE FROM ${table}`);
            console.log(`   Cleared ${table}`);
          } catch (error) {
            console.log(`   Skipped ${table} (may not exist)`);
          }
        }

        // Reset sequences
        try {
          await client.query(`SELECT setval(pg_get_serial_sequence('schema_migrations', 'id'), 1, false)`);
          console.log('   Reset migration sequence');
        } catch (error) {
          // Schema migrations table might not exist
        }
      });

      console.log('✅ Database reset completed');
      return { success: true };
    } catch (error) {
      console.error('❌ Database reset failed:', error);
      return { success: false, error: error.message };
    }
  }
}

// CLI interface
async function main() {
  const command = process.argv[2];
  const seedRunner = new SeedRunner();

  // Parse command line options
  const options = {};
  const args = process.argv.slice(3);

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--force') {
      options.force = true;
    } else if (arg === '--files' && args[i + 1]) {
      options.files = args[i + 1].split(',');
      i++; // Skip next argument
    }
  }

  // Ensure database is connected
  await seedRunner.db.initialize();

  switch (command) {
    case 'seed':
    case 'run':
      await seedRunner.seed(options);
      break;

    case 'reset':
      await seedRunner.reset();
      break;

    case 'summary':
      await seedRunner.showSummary();
      break;

    default:
      console.log('🌱 Database Seeding Tool');
      console.log('');
      console.log('Usage:');
      console.log('  node seed.js seed [--force] [--files file1.sql,file2.sql]  # Run seed files');
      console.log('  node seed.js run  [--force]                                 # Alias for seed');
      console.log('  node seed.js reset                                          # Reset database');
      console.log('  node seed.js summary                                        # Show database summary');
      console.log('');
      console.log('Options:');
      console.log('  --force       - Force reseed even if database appears seeded');
      console.log('  --files       - Run specific seed files (comma-separated)');
      console.log('');
      console.log('Examples:');
      console.log('  node seed.js seed                           # Seed database');
      console.log('  node seed.js seed --force                   # Force reseed');
      console.log('  node seed.js seed --files 01_default_data.sql # Run specific file');
      console.log('  node seed.js reset                          # Reset database');
      break;
  }

  // Close database connection
  await seedRunner.db.close();
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('Seeding failed:', error);
    process.exit(1);
  });
}

export { SeedRunner };
export default seedRunner;