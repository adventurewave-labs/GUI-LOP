#!/usr/bin/env node

/**
 * Database Restore Script
 * Node.js-based database restoration with enhanced features
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { db } from '../config/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class DatabaseRestorer {
  constructor() {
    this.db = db;
  }

  /**
   * List available backups
   */
  async listBackups() {
    const backupDir = process.env.BACKUP_PATH || '/backups';

    try {
      const files = await fs.readdir(backupDir);
      const backups = files
        .filter(file => file.startsWith('gui_lop_backup_') && (file.endsWith('.sql') || file.endsWith('.sql.gz')))
        .map(file => ({
          filename: file,
          path: path.join(backupDir, file),
          compressed: file.endsWith('.gz')
        }));

      // Get file stats
      const backupsWithStats = await Promise.all(
        backups.map(async (backup) => {
          const stats = await fs.stat(backup.path);
          const metaPath = backup.path + '.meta';

          let metadata = {};
          try {
            const metaContent = await fs.readFile(metaPath, 'utf8');
            metadata = JSON.parse(metaContent);
          } catch (error) {
            // Metadata file doesn't exist or is invalid
          }

          return {
            ...backup,
            size: stats.size,
            created: stats.birthtime,
            modified: stats.mtime,
            metadata
          };
        })
      );

      // Sort by creation date (newest first)
      backupsWithStats.sort((a, b) => b.created - a.created);

      return backupsWithStats;
    } catch (error) {
      console.error('Failed to list backups:', error);
      return [];
    }
  }

  /**
   * Get backup details
   */
  async getBackupDetails(backupPath) {
    try {
      const stats = await fs.stat(backupPath);
      const metaPath = backupPath + '.meta';

      let metadata = {};
      try {
        const metaContent = await fs.readFile(metaPath, 'utf8');
        metadata = JSON.parse(metaContent);
      } catch (error) {
        // Metadata file doesn't exist or is invalid
      }

      return {
        path: backupPath,
        filename: path.basename(backupPath),
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime,
        compressed: backupPath.endsWith('.gz'),
        metadata
      };
    } catch (error) {
      throw new Error(`Failed to get backup details: ${error.message}`);
    }
  }

  /**
   * Verify backup integrity
   */
  async verifyBackup(backupPath) {
    console.log(`🔍 Verifying backup: ${path.basename(backupPath)}`);

    return new Promise((resolve, reject) => {
      if (backupPath.endsWith('.gz')) {
        // Verify compressed backup
        const gunzip = spawn('gunzip', ['-t', backupPath]);

        gunzip.on('close', (code) => {
          if (code === 0) {
            console.log('✅ Backup integrity verified (compressed)');
            resolve(true);
          } else {
            console.log('❌ Backup integrity check failed (compressed)');
            reject(new Error('Compressed backup is corrupted'));
          }
        });

        gunzip.on('error', (error) => {
          reject(new Error(`Failed to verify compressed backup: ${error.message}`));
        });
      } else {
        // Verify uncompressed backup
        const pgRestore = spawn('pg_restore', ['--list', backupPath]);

        let stderr = '';

        pgRestore.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        pgRestore.on('close', (code) => {
          if (code === 0) {
            console.log('✅ Backup integrity verified');
            resolve(true);
          } else {
            console.log('❌ Backup integrity check failed');
            console.error('pg_restore error:', stderr);
            reject(new Error('Backup file is not a valid PostgreSQL dump'));
          }
        });

        pgRestore.on('error', (error) => {
          reject(new Error(`Failed to verify backup: ${error.message}`));
        });
      }
    });
  }

  /**
   * Create a test restore to a temporary database
   */
  async testRestore(backupPath) {
    console.log(`🧪 Testing restore with backup: ${path.basename(backupPath)}`);

    const testDbName = `gui_lop_test_restore_${Date.now()}`;

    try {
      // Create test database
      await this.createTestDatabase(testDbName);

      // Perform test restore
      await this.performRestore(backupPath, testDbName);

      // Verify test restore
      await this.verifyTestRestore(testDbName);

      console.log('✅ Test restore successful');
      return true;
    } catch (error) {
      console.error('❌ Test restore failed:', error.message);
      return false;
    } finally {
      // Clean up test database
      await this.cleanupTestDatabase(testDbName);
    }
  }

  /**
   * Create test database
   */
  async createTestDatabase(dbName) {
    const { DB_HOST, DB_PORT, DB_USER } = process.env;

    return new Promise((resolve, reject) => {
      const createdb = spawn('createdb', [
        '-h', DB_HOST || 'localhost',
        '-p', (DB_PORT || '5432').toString(),
        '-U', DB_USER || 'postgres',
        dbName
      ]);

      createdb.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Failed to create test database: exit code ${code}`));
        }
      });

      createdb.on('error', (error) => {
        reject(new Error(`Failed to create test database: ${error.message}`));
      });
    });
  }

  /**
   * Perform restore to specified database
   */
  async performRestore(backupPath, dbName) {
    const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD } = process.env;

    return new Promise((resolve, reject) => {
      const restoreArgs = [
        '-h', DB_HOST || 'localhost',
        '-p', (DB_PORT || '5432').toString(),
        '-U', DB_USER || 'postgres',
        '-d', dbName,
        '--verbose',
        '--clean',
        '--if-exists',
        '--no-owner',
        '--no-privileges'
      ];

      let pgRestore;

      if (backupPath.endsWith('.gz')) {
        // For compressed backups, pipe through gunzip
        const gunzip = spawn('gunzip', ['-c', backupPath]);
        pgRestore = spawn('pg_restore', restoreArgs);

        gunzip.stdout.pipe(pgRestore.stdin);

        gunzip.on('error', (error) => {
          reject(new Error(`Gunzip failed: ${error.message}`));
        });
      } else {
        // For uncompressed backups
        restoreArgs.push(backupPath);
        pgRestore = spawn('pg_restore', restoreArgs);
      }

      let stdout = '';
      let stderr = '';

      pgRestore.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      pgRestore.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      pgRestore.on('close', (code) => {
        if (code === 0) {
          resolve({ stdout, stderr });
        } else {
          reject(new Error(`Restore failed with exit code ${code}: ${stderr}`));
        }
      });

      pgRestore.on('error', (error) => {
        reject(new Error(`Restore process failed: ${error.message}`));
      });
    });
  }

  /**
   * Verify test restore
   */
  async verifyTestRestore(dbName) {
    // Connect to test database and run basic checks
    const testDb = new (await import('../config/database.js')).default();

    // Override database name for test
    const originalDbName = process.env.DB_NAME;
    process.env.DB_NAME = dbName;

    try {
      await testDb.initialize();

      // Check if key tables exist and have data
      const tables = ['users', 'workflows', 'workflow_templates'];

      for (const table of tables) {
        try {
          const result = await testDb.query(`SELECT COUNT(*) as count FROM ${table}`);
          console.log(`   ${table}: ${result.rows[0].count} records`);
        } catch (error) {
          console.log(`   ${table}: Not found or empty`);
        }
      }

      await testDb.close();
    } catch (error) {
      throw new Error(`Failed to verify test restore: ${error.message}`);
    } finally {
      process.env.DB_NAME = originalDbName;
    }
  }

  /**
   * Clean up test database
   */
  async cleanupTestDatabase(dbName) {
    const { DB_HOST, DB_PORT, DB_USER } = process.env;

    return new Promise((resolve, reject) => {
      const dropdb = spawn('dropdb', [
        '-h', DB_HOST || 'localhost',
        '-p', (DB_PORT || '5432').toString(),
        '-U', DB_USER || 'postgres',
        dbName
      ]);

      dropdb.on('close', (code) => {
        resolve();
      });

      dropdb.on('error', (error) => {
        // Don't reject for cleanup errors
        console.warn(`Warning: Failed to cleanup test database: ${error.message}`);
        resolve();
      });
    });
  }

  /**
   * Restore database from backup
   */
  async restore(backupPath, options = {}) {
    const { testMode = false, force = false } = options;

    console.log(`🔄 Restoring database from: ${path.basename(backupPath)}`);

    if (!testMode && !force) {
      console.log('⚠️  This will replace the current database!');
      console.log('   Use --test to perform a test restore first');
      console.log('   Use --force to skip this warning');

      // In a real implementation, you might want to prompt for confirmation
      // For now, we'll require explicit --force flag
      throw new Error('Use --force to confirm database restore');
    }

    // Verify backup exists
    try {
      await fs.access(backupPath);
    } catch (error) {
      throw new Error(`Backup file not found: ${backupPath}`);
    }

    // Verify backup integrity
    await this.verifyBackup(backupPath);

    if (testMode) {
      return await this.testRestore(backupPath);
    } else {
      // Perform actual restore
      const dbName = process.env.DB_NAME || 'gui_lop';
      console.log(`🗄️  Restoring to database: ${dbName}`);

      try {
        const result = await this.performRestore(backupPath, dbName);
        console.log('✅ Database restore completed successfully');
        console.log('📊 Restore output:', result.stdout.substring(0, 500) + '...');
        return true;
      } catch (error) {
        console.error('❌ Database restore failed:', error.message);
        throw error;
      }
    }
  }

  /**
   * Show backup information
   */
  async showBackupInfo(backupPath) {
    const details = await this.getBackupDetails(backupPath);

    console.log(`\n📋 Backup Information: ${details.filename}`);
    console.log(`   Path: ${details.path}`);
    console.log(`   Size: ${(details.size / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   Created: ${details.created.toISOString()}`);
    console.log(`   Modified: ${details.modified.toISOString()}`);
    console.log(`   Compressed: ${details.compressed ? 'Yes' : 'No'}`);

    if (details.metadata.backup_date) {
      console.log(`\n📊 Metadata:`);
      console.log(`   Database: ${details.metadata.database_name || 'Unknown'}`);
      console.log(`   Backup Date: ${details.metadata.backup_date}`);
      console.log(`   Duration: ${details.metadata.backup_duration_seconds || 'Unknown'}s`);
      console.log(`   PostgreSQL Version: ${details.metadata.postgres_version || 'Unknown'}`);
      console.log(`   Schema Version: ${details.metadata.schema_version || 'Unknown'}`);
      console.log(`   Backup Type: ${details.metadata.backup_type || 'Unknown'}`);
      console.log(`   Hostname: ${details.metadata.hostname || 'Unknown'}`);
    }
  }
}

// CLI interface
async function main() {
  const command = process.argv[2];
  const restorer = new DatabaseRestorer();

  // Parse command line options
  const options = {};
  const args = process.argv.slice(3);

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--test') {
      options.testMode = true;
    } else if (arg === '--force') {
      options.force = true;
    }
  }

  // Ensure database is connected
  try {
    await restorer.db.initialize();
  } catch (error) {
    console.error('Failed to connect to database:', error.message);
    process.exit(1);
  }

  switch (command) {
    case 'list':
      const backups = await restorer.listBackups();
      if (backups.length === 0) {
        console.log('No backups found');
      } else {
        console.log('\n📋 Available Backups:');
        console.log('   # | Filename | Size | Created | Database | Status');
        console.log('   --|----------|------|---------|----------|--------');

        backups.forEach((backup, index) => {
          const size = (backup.size / 1024 / 1024).toFixed(2) + ' MB';
          const created = backup.created.toISOString().split('T')[0];
          const database = backup.metadata.database_name || 'Unknown';
          const age = Math.floor((Date.now() - backup.created.getTime()) / (1000 * 60 * 60 * 24));
          const status = age < 1 ? 'Recent' : age > 30 ? 'Old' : 'OK';

          console.log(`   ${index + 1} | ${backup.filename.substring(0, 20)} | ${size} | ${created} | ${database} | ${status}`);
        });
      }
      break;

    case 'info':
      const backupPath = args.find(arg => !arg.startsWith('--'));
      if (!backupPath) {
        console.error('Backup path is required');
        console.log('Usage: node restore.js info <backup_path>');
        process.exit(1);
      }
      await restorer.showBackupInfo(backupPath);
      break;

    case 'verify':
      const verifyPath = args.find(arg => !arg.startsWith('--'));
      if (!verifyPath) {
        console.error('Backup path is required');
        console.log('Usage: node restore.js verify <backup_path>');
        process.exit(1);
      }
      try {
        await restorer.verifyBackup(verifyPath);
      } catch (error) {
        console.error('Verification failed:', error.message);
        process.exit(1);
      }
      break;

    case 'restore':
      const restorePath = args.find(arg => !arg.startsWith('--'));
      if (!restorePath) {
        console.error('Backup path is required');
        console.log('Usage: node restore.js restore <backup_path> [--test] [--force]');
        process.exit(1);
      }

      try {
        const success = await restorer.restore(restorePath, options);
        if (success) {
          console.log('\n🎉 Restore process completed successfully!');
        }
      } catch (error) {
        console.error('\n💥 Restore failed:', error.message);
        process.exit(1);
      }
      break;

    default:
      console.log('🗄️  Database Restore Tool');
      console.log('');
      console.log('Usage:');
      console.log('  node restore.js list                           # List available backups');
      console.log('  node restore.js info <backup_path>              # Show backup information');
      console.log('  node restore.js verify <backup_path>           # Verify backup integrity');
      console.log('  node restore.js restore <backup_path> [options] # Restore from backup');
      console.log('');
      console.log('Options:');
      console.log('  --test       - Perform test restore to temporary database');
      console.log('  --force      - Force restore without confirmation');
      console.log('');
      console.log('Examples:');
      console.log('  node restore.js list');
      console.log('  node restore.js info /backups/gui_lop_backup_20240101.sql.gz');
      console.log('  node restore.js verify /backups/gui_lop_backup_20240101.sql.gz');
      console.log('  node restore.js restore /backups/gui_lop_backup_20240101.sql.gz --test');
      console.log('  node restore.js restore /backups/gui_lop_backup_20240101.sql.gz --force');
      break;
  }

  // Close database connection
  await restorer.db.close();
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('Restore operation failed:', error);
    process.exit(1);
  });
}

export { DatabaseRestorer };
export default restorer;