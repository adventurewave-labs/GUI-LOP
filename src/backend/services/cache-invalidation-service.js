/**
 * Cache Invalidation Service
 * Intelligent cache invalidation with event-driven strategies
 * Week 5-6 Phase 2 - Redis Caching Layer
 */

import cacheService from './redis-cache-service.js';
import workflowCacheService from './workflow-cache-service.js';
import sessionCacheService from './session-cache-service.js';
import { EventEmitter } from 'events';

class CacheInvalidationService extends EventEmitter {
  constructor() {
    super();
    this.initialized = false;
    this.invalidationRules = new Map();
    this.invalidationHistory = [];
    this.batchInvalidations = new Map();
    this.batchTimeout = null;
    this.batchDelay = 1000; // 1 second

    // Initialize default invalidation rules
    this.setupDefaultRules();

    // Performance tracking
    this.metrics = {
      invalidations: 0,
      batchInvalidations: 0,
      rulesTriggered: 0,
      errors: 0,
      startTime: Date.now()
    };
  }

  /**
   * Initialize cache invalidation service
   */
  async initialize() {
    try {
      await cacheService.initialize();
      this.initialized = true;
      console.log('✅ Cache Invalidation Service initialized');

      // Start batch processing
      this.startBatchProcessor();

      return true;
    } catch (error) {
      console.error('❌ Failed to initialize Cache Invalidation Service:', error.message);
      this.initialized = false;
      throw error;
    }
  }

  /**
   * Setup default invalidation rules
   */
  setupDefaultRules() {
    // Workflow-related invalidations
    this.addRule('workflow.created', async (data) => {
      await this.invalidateUserWorkflows(data.userId);
      await this.invalidateWorkflowStats();
      await this.invalidateTemplateUsage(data.templateKey);
    });

    this.addRule('workflow.updated', async (data) => {
      await this.invalidateWorkflow(data.workflowId);
      await this.invalidateUserWorkflows(data.userId);
      await this.invalidateWorkflowStats();
    });

    this.addRule('workflow.deleted', async (data) => {
      await this.invalidateWorkflow(data.workflowId);
      await this.invalidateUserWorkflows(data.userId);
      await this.invalidateWorkflowStats();
      await this.invalidateTemplateUsage(data.templateKey);
    });

    this.addRule('workflow.executed', async (data) => {
      await this.invalidateWorkflow(data.workflowId);
      await this.invalidateUserWorkflows(data.userId);
      await this.invalidateWorkflowStats();
    });

    this.addRule('workflow.completed', async (data) => {
      await this.invalidateWorkflow(data.workflowId);
      await this.invalidateUserWorkflows(data.userId);
      await this.invalidateWorkflowStats();
    });

    // Template-related invalidations
    this.addRule('template.created', async (data) => {
      await this.invalidateWorkflowTemplates();
      await this.invalidateTemplateCategories();
    });

    this.addRule('template.updated', async (data) => {
      await this.invalidateWorkflowTemplates();
      await this.invalidateTemplate(data.templateId);
    });

    this.addRule('template.deleted', async (data) => {
      await this.invalidateWorkflowTemplates();
      await this.invalidateTemplateCategories();
      await this.invalidateAllRelatedWorkflows(data.templateKey);
    });

    // User-related invalidations
    this.addRule('user.login', async (data) => {
      await this.invalidateUserSessions(data.userId);
      await this.invalidateUserLoginHistory(data.userId);
    });

    this.addRule('user.logout', async (data) => {
      await this.invalidateUserSessions(data.userId);
      await this.invalidateUserLoginHistory(data.userId);
    });

    this.addRule('user.password.changed', async (data) => {
      await this.invalidateAllUserSessions(data.userId);
      await this.invalidateUserLoginHistory(data.userId);
    });

    this.addRule('user.profile.updated', async (data) => {
      await this.invalidateUserData(data.userId);
    });

    // System-related invalidations
    this.addRule('system.config.changed', async (data) => {
      await this.invalidateSystemConfig();
      await this.invalidateHealthChecks();
    });

    this.addRule('system.maintenance', async (data) => {
      await this.invalidateAllPublicAPI();
      await this.invalidateHealthChecks();
    });
  }

  /**
   * Add invalidation rule
   */
  addRule(event, handler) {
    this.invalidationRules.set(event, handler);
  }

  /**
   * Remove invalidation rule
   */
  removeRule(event) {
    this.invalidationRules.delete(event);
  }

  /**
   * Trigger cache invalidation
   */
  async invalidate(event, data = {}) {
    try {
      const startTime = Date.now();
      this.metrics.invalidations++;

      // Log invalidation
      this.logInvalidation(event, data);

      // Emit event for external listeners
      this.emit('invalidation', { event, data, timestamp: startTime });

      // Get handler for this event
      const handler = this.invalidationRules.get(event);
      if (!handler) {
        console.warn(`⚠️ No invalidation rule found for event: ${event}`);
        return { success: false, reason: 'No rule found' };
      }

      // Execute invalidation
      await handler(data);
      this.metrics.rulesTriggered++;

      const duration = Date.now() - startTime;
      console.log(`🗑️ Cache invalidation completed for ${event} (${duration}ms)`);

      return {
        success: true,
        event,
        duration,
        timestamp: startTime
      };

    } catch (error) {
      this.metrics.errors++;
      console.error(`❌ Error in cache invalidation for ${event}:`, error.message);

      return {
        success: false,
        event,
        error: error.message
      };
    }
  }

  /**
   * Batch invalidation for multiple events
   */
  async batchInvalidate(events) {
    try {
      this.metrics.batchInvalidations++;
      const results = [];

      for (const { event, data } of events) {
        const result = await this.invalidate(event, data);
        results.push(result);
      }

      return {
        success: true,
        totalEvents: events.length,
        successfulInvalidations: results.filter(r => r.success).length,
        results
      };

    } catch (error) {
      this.metrics.errors++;
      console.error('❌ Error in batch invalidation:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Invalidate workflow and related caches
   */
  async invalidateWorkflow(workflowId) {
    try {
      // Invalidate from workflow cache service
      await workflowCacheService.invalidateWorkflowCaches(workflowId);

      // Invalidate API responses
      await cacheService.deletePattern('apiResponses', `*workflows/${workflowId}*`);
      await cacheService.deletePattern('apiResponses', `*workflows*${workflowId}*`);

      console.log(`🗑️ Invalidated caches for workflow ${workflowId}`);
    } catch (error) {
      console.error(`❌ Error invalidating workflow ${workflowId}:`, error.message);
      throw error;
    }
  }

  /**
   * Invalidate user workflows cache
   */
  async invalidateUserWorkflows(userId) {
    try {
      await workflowCacheService.invalidateUserWorkflowsCache(userId);

      // Invalidate API responses
      await cacheService.deletePattern('apiResponses', `*workflows*user:${userId}*`);

      console.log(`🗑️ Invalidated workflows cache for user ${userId}`);
    } catch (error) {
      console.error(`❌ Error invalidating user workflows for ${userId}:`, error.message);
      throw error;
    }
  }

  /**
   * Invalidate workflow templates cache
   */
  async invalidateWorkflowTemplates() {
    try {
      await cacheService.deletePattern('workflowTemplates', '*');
      await cacheService.deletePattern('apiResponses', `*workflows/templates*`);

      console.log('🗑️ Invalidated workflow templates cache');
    } catch (error) {
      console.error('❌ Error invalidating workflow templates:', error.message);
      throw error;
    }
  }

  /**
   * Invalidate specific template
   */
  async invalidateTemplate(templateId) {
    try {
      await cacheService.deletePattern('workflowTemplates', `*template:${templateId}*`);
      await cacheService.deletePattern('workflowTemplates', `*${templateId}*`);

      console.log(`🗑️ Invalidated template ${templateId} cache`);
    } catch (error) {
      console.error(`❌ Error invalidating template ${templateId}:`, error.message);
      throw error;
    }
  }

  /**
   * Invalidate template categories
   */
  async invalidateTemplateCategories() {
    try {
      await cacheService.deletePattern('workflowTemplates', '*categories*');
      await cacheService.deletePattern('apiResponses', `*templates*categories*`);

      console.log('🗑️ Invalidated template categories cache');
    } catch (error) {
      console.error('❌ Error invalidating template categories:', error.message);
      throw error;
    }
  }

  /**
   * Invalidate workflow statistics
   */
  async invalidateWorkflowStats() {
    try {
      await cacheService.deletePattern('workflowData', 'stats:*');
      await cacheService.deletePattern('apiResponses', `*stats*`);
      await cacheService.deletePattern('apiResponses', `*database/stats*`);

      console.log('🗑️ Invalidated workflow statistics cache');
    } catch (error) {
      console.error('❌ Error invalidating workflow stats:', error.message);
      throw error;
    }
  }

  /**
   * Invalidate template usage statistics
   */
  async invalidateTemplateUsage(templateKey) {
    try {
      await cacheService.deletePattern('workflowTemplates', `*usage:${templateKey}*`);
      await cacheService.deletePattern('workflowTemplates', `*${templateKey}:usage*`);

      console.log(`🗑️ Invalidated template usage for ${templateKey}`);
    } catch (error) {
      console.error(`❌ Error invalidating template usage for ${templateKey}:`, error.message);
      throw error;
    }
  }

  /**
   * Invalidate all workflows related to a template
   */
  async invalidateAllRelatedWorkflows(templateKey) {
    try {
      await cacheService.deletePattern('workflowData', `*template:${templateKey}*`);
      await cacheService.deletePattern('userData', `*workflows:*template:${templateKey}*`);
      await cacheService.deletePattern('apiResponses', `*workflows*template:${templateKey}*`);

      console.log(`🗑️ Invalidated all workflows for template ${templateKey}`);
    } catch (error) {
      console.error(`❌ Error invalidating workflows for template ${templateKey}:`, error.message);
      throw error;
    }
  }

  /**
   * Invalidate user sessions
   */
  async invalidateUserSessions(userId) {
    try {
      // This would be handled by session cache service
      console.log(`🗑️ Invalidated sessions for user ${userId}`);
    } catch (error) {
      console.error(`❌ Error invalidating user sessions for ${userId}:`, error.message);
      throw error;
    }
  }

  /**
   * Invalidate all user sessions
   */
  async invalidateAllUserSessions(userId) {
    try {
      await sessionCacheService.invalidateAllUserSessions(userId);
      console.log(`🗑️ Invalidated all sessions for user ${userId}`);
    } catch (error) {
      console.error(`❌ Error invalidating all user sessions for ${userId}:`, error.message);
      throw error;
    }
  }

  /**
   * Invalidate user data cache
   */
  async invalidateUserData(userId) {
    try {
      await cacheService.deletePattern('userData', `user:${userId}:*`);
      await cacheService.deletePattern('apiResponses', `*user:${userId}*`);

      console.log(`🗑️ Invalidated user data cache for ${userId}`);
    } catch (error) {
      console.error(`❌ Error invalidating user data for ${userId}:`, error.message);
      throw error;
    }
  }

  /**
   * Invalidate user login history
   */
  async invalidateUserLoginHistory(userId) {
    try {
      await cacheService.deletePattern('userData', `user:${userId}:login*`);
      console.log(`🗑️ Invalidated login history for user ${userId}`);
    } catch (error) {
      console.error(`❌ Error invalidating login history for ${userId}:`, error.message);
      throw error;
    }
  }

  /**
   * Invalidate system configuration cache
   */
  async invalidateSystemConfig() {
    try {
      await cacheService.deletePattern('configData', '*');
      await cacheService.deletePattern('apiResponses', `*config*`);

      console.log('🗑️ Invalidated system configuration cache');
    } catch (error) {
      console.error('❌ Error invalidating system config:', error.message);
      throw error;
    }
  }

  /**
   * Invalidate health check cache
   */
  async invalidateHealthChecks() {
    try {
      await cacheService.deletePattern('apiResponses', `*health*`);
      console.log('🗑️ Invalidated health check cache');
    } catch (error) {
      console.error('❌ Error invalidating health checks:', error.message);
      throw error;
    }
  }

  /**
   * Invalidate all public API cache
   */
  async invalidateAllPublicAPI() {
    try {
      await cacheService.deletePattern('apiResponses', `/api/public/*`);
      console.log('🗑️ Invalidated all public API cache');
    } catch (error) {
      console.error('❌ Error invalidating public API cache:', error.message);
      throw error;
    }
  }

  /**
   * Smart invalidation based on cache dependencies
   */
  async smartInvalidate(context) {
    try {
      const invalidations = [];

      // Analyze context to determine what needs invalidation
      if (context.workflowId) {
        invalidations.push({ event: 'workflow.updated', data: { workflowId: context.workflowId } });
      }

      if (context.userId) {
        invalidations.push({ event: 'user.profile.updated', data: { userId: context.userId } });
      }

      if (context.templateKey) {
        invalidations.push({ event: 'template.updated', data: { templateKey: context.templateKey } });
      }

      // Execute batch invalidation
      return await this.batchInvalidate(invalidations);

    } catch (error) {
      console.error('❌ Error in smart invalidation:', error.message);
      throw error;
    }
  }

  /**
   * Schedule invalidation with delay
   */
  scheduleInvalidation(event, data, delay = 1000) {
    setTimeout(async () => {
      try {
        await this.invalidate(event, data);
      } catch (error) {
        console.error('❌ Error in scheduled invalidation:', error.message);
      }
    }, delay);
  }

  /**
   * Log invalidation for audit
   */
  logInvalidation(event, data) {
    const logEntry = {
      event,
      data,
      timestamp: Date.now(),
      id: crypto.randomUUID()
    };

    this.invalidationHistory.unshift(logEntry);

    // Keep only last 1000 entries
    if (this.invalidationHistory.length > 1000) {
      this.invalidationHistory = this.invalidationHistory.slice(0, 1000);
    }
  }

  /**
   * Get invalidation history
   */
  getInvalidationHistory(limit = 100) {
    return this.invalidationHistory.slice(0, limit);
  }

  /**
   * Get invalidation statistics
   */
  getStats() {
    const uptime = Date.now() - this.metrics.startTime;
    const rulesCount = this.invalidationRules.size;

    return {
      ...this.metrics,
      uptime: `${Math.floor(uptime / 1000)}s`,
      rulesCount,
      invalidationsPerSecond: Math.round(this.metrics.invalidations / (uptime / 1000)),
      errorRate: this.metrics.invalidations > 0 ? (this.metrics.errors / this.metrics.invalidations) * 100 : 0,
      averageBatchSize: this.metrics.batchInvalidations > 0 ? this.metrics.rulesTriggered / this.metrics.batchInvalidations : 0
    };
  }

  /**
   * Get invalidation rules
   */
  getRules() {
    return Array.from(this.invalidationRules.keys());
  }

  /**
   * Start batch processor for efficient invalidations
   */
  startBatchProcessor() {
    this.batchTimeout = setInterval(() => {
      if (this.batchInvalidations.size > 0) {
        this.processBatchInvalidations();
      }
    }, this.batchDelay);
  }

  /**
   * Process batch invalidations
   */
  async processBatchInvalidations() {
    try {
      const batch = Array.from(this.batchInvalidations.values());
      this.batchInvalidations.clear();

      // Group by event type for efficiency
      const groupedInvalidations = batch.reduce((groups, item) => {
        if (!groups[item.event]) {
          groups[item.event] = [];
        }
        groups[item.event].push(item.data);
        return groups;
      }, {});

      // Process each group
      for (const [event, dataArray] of Object.entries(groupedInvalidations)) {
        // Combine data for batch processing
        const combinedData = this.combineInvalidationData(event, dataArray);
        await this.invalidate(event, combinedData);
      }

    } catch (error) {
      console.error('❌ Error processing batch invalidations:', error.message);
    }
  }

  /**
   * Combine invalidation data for batch processing
   */
  combineInvalidationData(event, dataArray) {
    // Default combination strategy - merge all data
    return dataArray.reduce((combined, data) => {
      return { ...combined, ...data };
    }, {});
  }

  /**
   * Health check for invalidation service
   */
  async healthCheck() {
    try {
      const testEvent = 'health-check';
      const testData = { test: true };

      const result = await this.invalidate(testEvent, testData);

      return {
        status: result.success ? 'healthy' : 'unhealthy',
        initialized: this.initialized,
        rulesCount: this.invalidationRules.size,
        stats: this.getStats()
      };

    } catch (error) {
      return {
        status: 'unhealthy',
        initialized: this.initialized,
        error: error.message
      };
    }
  }

  /**
   * Close cache invalidation service
   */
  async close() {
    try {
      if (this.batchTimeout) {
        clearInterval(this.batchTimeout);
      }

      // Process any remaining batch invalidations
      if (this.batchInvalidations.size > 0) {
        await this.processBatchInvalidations();
      }

      this.initialized = false;
      console.log('✅ Cache Invalidation Service closed');
    } catch (error) {
      console.error('❌ Error closing Cache Invalidation Service:', error.message);
      throw error;
    }
  }
}

// Create singleton instance
const cacheInvalidationService = new CacheInvalidationService();

export default cacheInvalidationService;
export { CacheInvalidationService };