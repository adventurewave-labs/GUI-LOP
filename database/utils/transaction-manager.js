/**
 * Transaction Manager
 * Advanced transaction management with isolation levels, retries, and rollback capabilities
 */

import { randomUUID } from 'crypto';
import { defaultErrorHandler } from './error-handler.js';

/**
 * Transaction configuration options
 */
const DEFAULT_CONFIG = {
  isolationLevel: 'READ_COMMITTED',
  timeout: 30000, // 30 seconds
  retryAttempts: 3,
  retryDelay: 1000,
  readOnly: false,
  deferrable: false
};

/**
 * Isolation levels supported by PostgreSQL
 */
const ISOLATION_LEVELS = {
  READ_UNCOMMITTED: 'READ UNCOMMITTED',
  READ_COMMITTED: 'READ COMMITTED',
  REPEATABLE_READ: 'REPEATABLE READ',
  SERIALIZABLE: 'SERIALIZABLE'
};

/**
 * Transaction status
 */
const TRANSACTION_STATUS = {
  ACTIVE: 'ACTIVE',
  COMMITTED: 'COMMITTED',
  ROLLED_BACK: 'ROLLED_BACK',
  FAILED: 'FAILED'
};

/**
 * Transaction manager class
 */
class TransactionManager {
  constructor(pool, options = {}) {
    this.pool = pool;
    this.config = { ...DEFAULT_CONFIG, ...options };
    this.errorHandler = options.errorHandler || defaultErrorHandler;
    this.activeTransactions = new Map();
  }

  /**
   * Begin a new transaction
   */
  async begin(options = {}) {
    const config = { ...this.config, ...options };
    const transactionId = randomUUID();
    const startTime = Date.now();

    try {
      const client = await this.pool.connect();

      // Set transaction configuration
      const queries = [];

      queries.push(`BEGIN`);

      if (config.isolationLevel) {
        queries.push(`SET TRANSACTION ISOLATION LEVEL ${config.isolationLevel}`);
      }

      if (config.readOnly) {
        queries.push(`SET TRANSACTION READ ONLY`);
      }

      if (config.deferrable) {
        queries.push(`SET TRANSACTION DEFERRABLE`);
      }

      // Execute configuration queries
      for (const query of queries) {
        await client.query(query);
      }

      const transaction = {
        id: transactionId,
        client,
        config,
        startTime,
        status: TRANSACTION_STATUS.ACTIVE,
        operations: [],
        savepoints: new Map(),
        queryCount: 0
      };

      this.activeTransactions.set(transactionId, transaction);

      return new ManagedTransaction(transaction, this);
    } catch (error) {
      throw this.errorHandler.handleError(error, {
        operation: 'begin_transaction',
        transactionId
      });
    }
  }

  /**
   * Get active transaction by ID
   */
  getTransaction(transactionId) {
    return this.activeTransactions.get(transactionId);
  }

  /**
   * List all active transactions
   */
  getActiveTransactions() {
    return Array.from(this.activeTransactions.values()).map(tx => ({
      id: tx.id,
      status: tx.status,
      startTime: tx.startTime,
      duration: Date.now() - tx.startTime,
      operationCount: tx.operations.length,
      queryCount: tx.queryCount
    }));
  }

  /**
   * Force cleanup of stuck transactions
   */
  async cleanupStuckTransactions(timeout = 300000) { // 5 minutes default
    const now = Date.now();
    const stuckTransactions = [];

    for (const [id, transaction] of this.activeTransactions.entries()) {
      if (now - transaction.startTime > timeout) {
        stuckTransactions.push(transaction);
      }
    }

    for (const transaction of stuckTransactions) {
      try {
        console.warn(`Cleaning up stuck transaction: ${transaction.id}`);
        await this.forceRollback(transaction);
      } catch (error) {
        console.error(`Failed to cleanup stuck transaction ${transaction.id}:`, error);
      }
    }

    return stuckTransactions.length;
  }

  /**
   * Force rollback a transaction
   */
  async forceRollback(transaction) {
    try {
      if (transaction.client) {
        await transaction.client.query('ROLLBACK');
        transaction.client.release();
      }
      transaction.status = TRANSACTION_STATUS.ROLLED_BACK;
      this.activeTransactions.delete(transaction.id);
    } catch (error) {
      // Force release client even if rollback fails
      if (transaction.client) {
        transaction.client.release();
      }
      transaction.status = TRANSACTION_STATUS.FAILED;
      this.activeTransactions.delete(transaction.id);
    }
  }

  /**
   * Internal method to commit transaction
   */
  async _commit(transaction) {
    try {
      await transaction.client.query('COMMIT');
      transaction.status = TRANSACTION_STATUS.COMMITTED;
      this.activeTransactions.delete(transaction.id);
    } catch (error) {
      transaction.status = TRANSACTION_STATUS.FAILED;
      throw error;
    } finally {
      transaction.client.release();
    }
  }

  /**
   * Internal method to rollback transaction
   */
  async _rollback(transaction) {
    try {
      await transaction.client.query('ROLLBACK');
      transaction.status = TRANSACTION_STATUS.ROLLED_BACK;
    } catch (error) {
      transaction.status = TRANSACTION_STATUS.FAILED;
      throw error;
    } finally {
      this.activeTransactions.delete(transaction.id);
      transaction.client.release();
    }
  }

  /**
   * Internal method to execute query in transaction
   */
  async _query(transaction, text, params = []) {
    const operation = {
      query: text,
      params: params.length > 0 ? '[REDACTED]' : null,
      timestamp: Date.now()
    };

    try {
      const result = await transaction.client.query(text, params);
      operation.success = true;
      operation.rowCount = result.rowCount;
      transaction.operations.push(operation);
      transaction.queryCount++;

      return result;
    } catch (error) {
      operation.success = false;
      operation.error = error.message;
      transaction.operations.push(operation);
      throw error;
    }
  }

  /**
   * Internal method to create savepoint
   */
  async _createSavepoint(transaction, name) {
    const savepointName = name || `sp_${transaction.savepoints.size + 1}`;
    await this._query(transaction, `SAVEPOINT ${savepointName}`);

    const savepoint = {
      name: savepointName,
      createdAt: Date.now(),
      operationCount: transaction.operations.length
    };

    transaction.savepoints.set(savepointName, savepoint);
    return savepointName;
  }

  /**
   * Internal method to rollback to savepoint
   */
  async _rollbackToSavepoint(transaction, name) {
    if (!transaction.savepoints.has(name)) {
      throw new Error(`Savepoint '${name}' not found`);
    }

    await this._query(transaction, `ROLLBACK TO SAVEPOINT ${name}`);

    // Remove savepoints created after this one
    const savepointsToRemove = [];
    for (const [spName, savepoint] of transaction.savepoints) {
      if (savepoint.createdAt > transaction.savepoints.get(name).createdAt) {
        savepointsToRemove.push(spName);
      }
    }

    savepointsToRemove.forEach(spName => transaction.savepoints.delete(spName));
  }

  /**
   * Internal method to release savepoint
   */
  async _releaseSavepoint(transaction, name) {
    if (!transaction.savepoints.has(name)) {
      throw new Error(`Savepoint '${name}' not found`);
    }

    await this._query(transaction, `RELEASE SAVEPOINT ${name}`);
    transaction.savepoints.delete(name);
  }
}

/**
 * Managed transaction class
 */
class ManagedTransaction {
  constructor(transaction, manager) {
    this.transaction = transaction;
    this.manager = manager;
  }

  /**
   * Execute a query in this transaction
   */
  async query(text, params = []) {
    if (this.transaction.status !== TRANSACTION_STATUS.ACTIVE) {
      throw new Error(`Transaction is not active (status: ${this.transaction.status})`);
    }

    return await this.manager._query(this.transaction, text, params);
  }

  /**
   * Create a savepoint
   */
  async savepoint(name) {
    if (this.transaction.status !== TRANSACTION_STATUS.ACTIVE) {
      throw new Error(`Transaction is not active (status: ${this.transaction.status})`);
    }

    return await this.manager._createSavepoint(this.transaction, name);
  }

  /**
   * Rollback to savepoint
   */
  async rollbackTo(name) {
    if (this.transaction.status !== TRANSACTION_STATUS.ACTIVE) {
      throw new Error(`Transaction is not active (status: ${this.transaction.status})`);
    }

    return await this.manager._rollbackToSavepoint(this.transaction, name);
  }

  /**
   * Release savepoint
   */
  async release(name) {
    if (this.transaction.status !== TRANSACTION_STATUS.ACTIVE) {
      throw new Error(`Transaction is not active (status: ${this.transaction.status})`);
    }

    return await this.manager._releaseSavepoint(this.transaction, name);
  }

  /**
   * Commit the transaction
   */
  async commit() {
    if (this.transaction.status !== TRANSACTION_STATUS.ACTIVE) {
      throw new Error(`Transaction is not active (status: ${this.transaction.status})`);
    }

    await this.manager._commit(this.transaction);
  }

  /**
   * Rollback the transaction
   */
  async rollback() {
    if (this.transaction.status !== TRANSACTION_STATUS.ACTIVE) {
      throw new Error(`Transaction is not active (status: ${this.transaction.status})`);
    }

    await this.manager._rollback(this.transaction);
  }

  /**
   * Get transaction information
   */
  getInfo() {
    return {
      id: this.transaction.id,
      status: this.transaction.status,
      startTime: this.transaction.startTime,
      duration: Date.now() - this.transaction.startTime,
      operationCount: this.transaction.operations.length,
      queryCount: this.transaction.queryCount,
      savepointCount: this.transaction.savepoints.size,
      config: this.transaction.config
    };
  }

  /**
   * Get transaction operations history
   */
  getOperations() {
    return this.transaction.operations.map(op => ({
      query: op.query.substring(0, 100), // Truncate for security
      timestamp: op.timestamp,
      success: op.success,
      rowCount: op.rowCount,
      error: op.error
    }));
  }
}

/**
 * Transaction helper functions
 */
class TransactionHelper {
  constructor(transactionManager) {
    this.manager = transactionManager;
  }

  /**
   * Execute callback in a transaction with automatic commit/rollback
   */
  async inTransaction(callback, options = {}) {
    const tx = await this.manager.begin(options);

    try {
      const result = await callback(tx);
      await tx.commit();
      return result;
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  }

  /**
   * Execute multiple operations in parallel within a transaction
   */
  async inTransactionParallel(operations, options = {}) {
    const tx = await this.manager.begin(options);

    try {
      const results = await Promise.all(
        operations.map(op => op(tx))
      );
      await tx.commit();
      return results;
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  }

  /**
   * Execute with retry logic
   */
  async inTransactionWithRetry(callback, options = {}) {
    const { retryAttempts = 3, retryDelay = 1000 } = options;
    let lastError;

    for (let attempt = 1; attempt <= retryAttempts; attempt++) {
      try {
        return await this.inTransaction(callback, options);
      } catch (error) {
        lastError = error;

        // Don't retry on certain errors
        if (!this.shouldRetry(error)) {
          throw error;
        }

        if (attempt === retryAttempts) {
          throw error;
        }

        const delay = retryDelay * attempt;
        await this.sleep(delay);
      }
    }

    throw lastError;
  }

  /**
   * Determine if error should be retried
   */
  shouldRetry(error) {
    const retryableErrors = [
      'serialization_failure',
      'deadlock_detected',
      'connection_failure',
      'timeout'
    ];

    return retryableErrors.some(retryable =>
      error.message.toLowerCase().includes(retryable)
    );
  }

  /**
   * Sleep utility
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Batch insert with transaction
   */
  async batchInsert(tableName, records, options = {}) {
    const { batchSize = 1000 } = options;

    return await this.inTransaction(async (tx) => {
      const results = [];

      for (let i = 0; i < records.length; i += batchSize) {
        const batch = records.slice(i, i + batchSize);

        // Create batch insert query
        const columns = Object.keys(batch[0]);
        const values = batch.map(record =>
          `(${columns.map((_, index) => `$${i * columns.length + index + 1}`).join(', ')})`
        ).join(', ');

        const flatValues = batch.flatMap(record => Object.values(record));

        const query = `
          INSERT INTO ${tableName} (${columns.join(', ')})
          VALUES ${values}
          RETURNING id
        `;

        const result = await tx.query(query, flatValues);
        results.push(...result.rows);
      }

      return results;
    }, options);
  }
}

// Export everything
export {
  TransactionManager,
  ManagedTransaction,
  TransactionHelper,
  ISOLATION_LEVELS,
  TRANSACTION_STATUS,
  DEFAULT_CONFIG
};

export default TransactionManager;