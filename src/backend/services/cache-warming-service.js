/**
 * Cache Warming Service
 * Intelligent cache warming with scheduled and event-driven strategies
 * Week 5-6 Phase 2 - Redis Caching Layer
 */

import cacheService from './redis-cache-service.js';
import workflowCacheService from './workflow-cache-service.js';
import { db, dbHelpers } from '../../database/config/database.js';

class CacheWarmingService {
  constructor() {
    this.initialized = false;
    this.warmingSchedule = new Map();
    this.warmingInProgress = new Set();
    this.warmingStats = {
      totalWarms: 0,
      successfulWarms: 0,
      failedWarms: 0,
      itemsWarmed: 0,
      totalWarmingTime: 0,
      lastWarmingTime: null
    };

    // Warming strategies
    this.strategies = {
      // Startup warming - essential data
      startup: {
        enabled: true,
        priority: 'high',
        delay: 5000, // 5 seconds after startup
        items: this.getStartupWarmingItems()
      },

      // Scheduled warming - periodic refresh
      scheduled: {
        enabled: true,
        interval: 300000, // 5 minutes
        priority: 'medium',
        items: this.getScheduledWarmingItems()
      },

      // Event-driven warming - triggered by specific events
      eventDriven: {
        enabled: true,
        priority: 'low',
        items: this.getEventDrivenWarmingItems()
      },

      // Predictive warming - based on usage patterns
      predictive: {
        enabled: true,
        priority: 'medium',
        items: this.getPredictiveWarmingItems()
      }
    };

    this.usageTracker = new Map();
    this.accessPatterns = new Map();
  }

  /**
   * Initialize cache warming service
   */
  async initialize() {
    try {
      await cacheService.initialize();
      this.initialized = true;
      console.log('✅ Cache Warming Service initialized');

      // Start scheduled warming
      this.startScheduledWarming();

      // Perform initial startup warming
      setTimeout(() => {
        this.performStartupWarming();
      }, this.strategies.startup.delay);

      // Start usage tracking
      this.startUsageTracking();

      return true;
    } catch (error) {
      console.error('❌ Failed to initialize Cache Warming Service:', error.message);
      this.initialized = false;
      throw error;
    }
  }

  /**
   * Get startup warming items
   */
  getStartupWarmingItems() {
    return [
      // Essential workflow templates
      {
        name: 'popular-workflow-templates',
        priority: 'high',
        namespace: 'workflowTemplates',
        fetcher: async () => {
          const result = await db.query(`
            SELECT
              id, name, description, template_key, steps, default_config,
              category, is_active, created_at, updated_at
            FROM workflow_templates
            WHERE is_active = true
            ORDER BY (SELECT COUNT(*) FROM workflows WHERE template_id = workflow_templates.id) DESC
            LIMIT 10
          `);
          return result.rows;
        },
        ttl: 7200,
        transform: (data) => data.map(template => ({
          ...template,
          complexity: template.steps ? template.steps.length > 6 ? 'advanced' : template.steps.length > 3 ? 'intermediate' : 'simple' : 'simple',
          estimatedDuration: template.steps ? `${template.steps.length * 2 + 5} minutes` : '5 minutes'
        }))
      },

      // Template categories
      {
        name: 'template-categories',
        priority: 'high',
        namespace: 'workflowTemplates',
        fetcher: async () => {
          const result = await db.query(`
            SELECT DISTINCT category, COUNT(*) as template_count
            FROM workflow_templates
            WHERE is_active = true AND category IS NOT NULL
            GROUP BY category
            ORDER BY template_count DESC
          `);
          return result.rows;
        },
        ttl: 86400,
        identifier: 'categories'
      },

      // System statistics
      {
        name: 'system-statistics',
        priority: 'medium',
        namespace: 'workflowData',
        fetcher: async () => {
          const stats = {};

          // Get workflow counts
          const workflowResult = await db.query(`
            SELECT
              status,
              COUNT(*) as count
            FROM workflows
            GROUP BY status
          `);

          stats.workflowStatusCounts = workflowResult.rows;

          // Get user count
          const userResult = await db.query('SELECT COUNT(*) as count FROM users');
          stats.userCount = parseInt(userResult.rows[0].count);

          // Get template count
          const templateResult = await db.query('SELECT COUNT(*) as count FROM workflow_templates WHERE is_active = true');
          stats.activeTemplateCount = parseInt(templateResult.rows[0].count);

          return stats;
        },
        ttl: 600,
        identifier: 'system-stats'
      },

      // Recent workflows for admin/dashboard
      {
        name: 'recent-workflows',
        priority: 'medium',
        namespace: 'workflowData',
        fetcher: async () => {
          const result = await db.query(`
            SELECT
              w.id, w.title, w.status, w.created_at,
              t.name as template_name,
              u.username as created_by_username
            FROM workflows w
            LEFT JOIN workflow_templates t ON w.template_id = t.id
            LEFT JOIN users u ON w.created_by = u.id
            ORDER BY w.created_at DESC
            LIMIT 20
          `);
          return result.rows;
        },
        ttl: 300,
        identifier: 'recent-workflows'
      }
    ];
  }

  /**
   * Get scheduled warming items
   */
  getScheduledWarmingItems() {
    return [
      // Popular templates (refreshed periodically)
      {
        name: 'refresh-popular-templates',
        priority: 'medium',
        namespace: 'workflowTemplates',
        fetcher: async () => {
          const result = await db.query(`
            SELECT
              id, name, description, template_key, steps, default_config,
              category, is_active, created_at, updated_at,
              (SELECT COUNT(*) FROM workflows WHERE template_id = workflow_templates.id AND created_at > NOW() - INTERVAL '24 hours') as recent_usage
            FROM workflow_templates
            WHERE is_active = true
            ORDER BY recent_usage DESC, (SELECT COUNT(*) FROM workflows WHERE template_id = workflow_templates.id) DESC
            LIMIT 20
          `);
          return result.rows;
        },
        ttl: 3600,
        identifier: 'popular-templates-refresh'
      },

      // Workflow statistics (refreshed)
      {
        name: 'refresh-workflow-stats',
        priority: 'medium',
        namespace: 'workflowData',
        fetcher: async () => {
          const stats = {};

          // 24 hour stats
          const dayStats = await db.query(`
            SELECT
              COUNT(*) as total,
              COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
              COUNT(CASE WHEN status = 'running' THEN 1 END) as running,
              COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
              AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) as avg_completion_time
            FROM workflows
            WHERE created_at >= NOW() - INTERVAL '24 hours'
          `);
          stats['24h'] = dayStats.rows[0];

          // 7 day stats
          const weekStats = await db.query(`
            SELECT
              COUNT(*) as total,
              COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
              COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed
            FROM workflows
            WHERE created_at >= NOW() - INTERVAL '7 days'
          `);
          stats['7d'] = weekStats.rows[0];

          return stats;
        },
        ttl: 900,
        identifier: 'workflow-stats-refresh'
      }
    ];
  }

  /**
   * Get event-driven warming items
   */
  getEventDrivenWarmingItems() {
    return [
      // User-specific workflows after login
      {
        name: 'user-workflows-after-login',
        priority: 'medium',
        namespace: 'userData',
        condition: (context) => context.event === 'user.login',
        fetcher: async (context) => {
          if (!context.userId) return null;

          const result = await db.query(`
            SELECT
              w.id, w.title, w.status, w.created_at, w.template_key,
              t.name as template_name, t.category
            FROM workflows w
            LEFT JOIN workflow_templates t ON w.template_id = t.id
            WHERE w.created_by = $1
            ORDER BY w.created_at DESC
            LIMIT 10
          `, [context.userId]);

          return result.rows;
        },
        ttl: 900,
        getIdentifier: (context) => `user:${context.userId}:recent-workflows`
      },

      // Template details when accessed
      {
        name: 'template-details-on-access',
        priority: 'low',
        namespace: 'workflowTemplates',
        condition: (context) => context.event === 'template.accessed',
        fetcher: async (context) => {
          if (!context.templateId) return null;

          const template = await dbHelpers.findById('workflow_templates', context.templateId);
          if (!template) return null;

          // Add related data
          const usageResult = await db.query(`
            SELECT COUNT(*) as usage_count
            FROM workflows
            WHERE template_id = $1
          `, [context.templateId]);

          return {
            ...template,
            usage_count: parseInt(usageResult.rows[0].usage_count)
          };
        },
        ttl: 3600,
        getIdentifier: (context) => `template:${context.templateId}:details`
      }
    ];
  }

  /**
   * Get predictive warming items based on usage patterns
   */
  getPredictiveWarmingItems() {
    return [
      // Frequently accessed templates
      {
        name: 'predictive-template-warming',
        priority: 'medium',
        namespace: 'workflowTemplates',
        fetcher: async () => {
          const popularPatterns = this.getPopularAccessPatterns('templates');
          const templateIds = popularPatterns
            .filter(pattern => pattern.count > 5) // Templates accessed more than 5 times
            .slice(0, 10) // Top 10
            .map(pattern => pattern.id);

          if (templateIds.length === 0) return null;

          const result = await db.query(`
            SELECT
              id, name, description, template_key, steps, default_config,
              category, is_active, created_at, updated_at
            FROM workflow_templates
            WHERE id = ANY($1) AND is_active = true
          `, [templateIds]);

          return result.rows;
        },
        ttl: 7200,
        identifier: 'predictive-popular-templates'
      },

      // User workflow patterns
      {
        name: 'predictive-user-workflows',
        priority: 'low',
        namespace: 'userData',
        fetcher: async () => {
          const activeUsers = this.getMostActiveUsers();
          const warmupData = [];

          for (const user of activeUsers.slice(0, 5)) { // Top 5 active users
            const result = await db.query(`
              SELECT
                w.id, w.title, w.status, w.created_at, w.template_key
              FROM workflows w
              WHERE w.created_by = $1
              ORDER BY w.created_at DESC
              LIMIT 5
            `, [user.userId]);

            if (result.rows.length > 0) {
              warmupData.push({
                identifier: `user:${user.userId}:recent-workflows`,
                data: result.rows
              });
            }
          }

          return warmupData;
        },
        ttl: 900,
        identifier: 'predictive-user-workflows'
      }
    ];
  }

  /**
   * Perform startup warming
   */
  async performStartupWarming() {
    if (!this.initialized) return;

    console.log('🔥 Starting startup cache warming...');
    const startTime = Date.now();

    try {
      const items = this.strategies.startup.items;
      const results = await this.warmCacheItems(items, 'startup');

      this.warmingStats.lastWarmingTime = Date.now();
      this.warmingStats.totalWarmingTime += Date.now() - startTime;

      console.log(`✅ Startup warming completed: ${results.successful}/${results.total} items warmed`);

      return results;
    } catch (error) {
      console.error('❌ Error in startup warming:', error.message);
      throw error;
    }
  }

  /**
   * Start scheduled warming
   */
  startScheduledWarming() {
    if (!this.strategies.scheduled.enabled) return;

    setInterval(async () => {
      if (this.warmingInProgress.has('scheduled')) {
        console.log('⏳ Scheduled warming already in progress, skipping...');
        return;
      }

      console.log('🔥 Starting scheduled cache warming...');
      const startTime = Date.now();

      try {
        this.warmingInProgress.add('scheduled');

        const items = this.strategies.scheduled.items;
        const results = await this.warmCacheItems(items, 'scheduled');

        this.warmingStats.lastWarmingTime = Date.now();
        this.warmingStats.totalWarmingTime += Date.now() - startTime;

        console.log(`✅ Scheduled warming completed: ${results.successful}/${results.total} items warmed`);

      } catch (error) {
        console.error('❌ Error in scheduled warming:', error.message);
      } finally {
        this.warmingInProgress.delete('scheduled');
      }
    }, this.strategies.scheduled.interval);
  }

  /**
   * Trigger event-driven warming
   */
  async triggerEventWarming(event, context = {}) {
    if (!this.strategies.eventDriven.enabled) return;

    const items = this.strategies.eventDriven.items.filter(item =>
      item.condition && item.condition({ event, ...context })
    );

    if (items.length === 0) return;

    console.log(`🔥 Triggering event-driven warming for ${event}...`);

    try {
      const results = await this.warmCacheItems(items, 'event-driven', { event, ...context });
      console.log(`✅ Event-driven warming completed: ${results.successful}/${results.total} items warmed`);

      return results;
    } catch (error) {
      console.error('❌ Error in event-driven warming:', error.message);
    }
  }

  /**
   * Trigger predictive warming
   */
  async triggerPredictiveWarming() {
    if (!this.strategies.predictive.enabled) return;

    if (this.warmingInProgress.has('predictive')) {
      console.log('⏳ Predictive warming already in progress, skipping...');
      return;
    }

    console.log('🔥 Starting predictive cache warming...');

    try {
      this.warmingInProgress.add('predictive');

      const items = this.strategies.predictive.items;
      const results = await this.warmCacheItems(items, 'predictive');

      console.log(`✅ Predictive warming completed: ${results.successful}/${results.total} items warmed`);

      return results;
    } catch (error) {
      console.error('❌ Error in predictive warming:', error.message);
    } finally {
      this.warmingInProgress.delete('predictive');
    }
  }

  /**
   * Warm cache items
   */
  async warmCacheItems(items, strategy = 'manual', context = {}) {
    const startTime = Date.now();
    const results = {
      total: items.length,
      successful: 0,
      failed: 0,
      items: [],
      duration: 0
    };

    for (const item of items) {
      try {
        const itemStartTime = Date.now();

        // Fetch data
        let data;
        if (typeof item.fetcher === 'function') {
          data = await item.fetcher(context);
        } else {
          data = item.data;
        }

        if (data === null || data === undefined) {
          console.log(`⚠️ No data for warming item: ${item.name}`);
          continue;
        }

        // Transform data if needed
        if (item.transform && typeof item.transform === 'function') {
          data = item.transform(data);
        }

        // Handle multiple identifiers
        if (Array.isArray(data) && data.length > 0 && item.identifier === undefined) {
          // Cache each item individually
          for (const dataItem of data) {
            const identifier = item.getIdentifier ?
              item.getIdentifier(context, dataItem) :
              `${item.name}:${dataItem.id || dataItem.name || 'unknown'}`;

            await cacheService.set(item.namespace, identifier, dataItem, item.ttl);
          }
        } else {
          // Cache as single item
          const identifier = item.getIdentifier ?
            item.getIdentifier(context, data) :
            item.identifier || item.name;

          await cacheService.set(item.namespace, identifier, data, item.ttl);
        }

        const itemDuration = Date.now() - itemStartTime;
        results.successful++;
        results.items.push({
          name: item.name,
          status: 'success',
          duration: itemDuration,
          dataSize: Array.isArray(data) ? data.length : 1
        });

        console.log(`✅ Warmed cache item: ${item.name} (${itemDuration}ms)`);

      } catch (error) {
        results.failed++;
        results.items.push({
          name: item.name,
          status: 'failed',
          error: error.message
        });

        console.error(`❌ Failed to warm cache item ${item.name}:`, error.message);
      }
    }

    results.duration = Date.now() - startTime;

    // Update stats
    this.warmingStats.totalWarms++;
    this.warmingStats.successfulWarms += results.successful;
    this.warmingStats.failedWarms += results.failed;
    this.warmingStats.itemsWarmed += results.successful;

    return results;
  }

  /**
   * Track usage patterns for predictive warming
   */
  trackAccess(resource, resourceId, userId = null) {
    const key = `${resource}:${resourceId}`;
    const now = Date.now();

    if (!this.accessPatterns.has(key)) {
      this.accessPatterns.set(key, {
        resource,
        id: resourceId,
        count: 0,
        firstAccess: now,
        lastAccess: now,
        users: new Set()
      });
    }

    const pattern = this.accessPatterns.get(key);
    pattern.count++;
    pattern.lastAccess = now;

    if (userId) {
      pattern.users.add(userId);
    }

    // Track user activity
    if (userId) {
      if (!this.usageTracker.has(userId)) {
        this.usageTracker.set(userId, {
          totalAccesses: 0,
          lastActivity: now,
          resources: new Set()
        });
      }

      const userUsage = this.usageTracker.get(userId);
      userUsage.totalAccesses++;
      userUsage.lastActivity = now;
      userUsage.resources.add(key);
    }
  }

  /**
   * Get popular access patterns
   */
  getPopularAccessPatterns(resourceType) {
    return Array.from(this.accessPatterns.values())
      .filter(pattern => pattern.resource === resourceType)
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Get most active users
   */
  getMostActiveUsers() {
    return Array.from(this.usageTracker.entries())
      .map(([userId, usage]) => ({
        userId,
        ...usage,
        uniqueResources: usage.resources.size
      }))
      .sort((a, b) => b.totalAccesses - a.totalAccesses);
  }

  /**
   * Start usage tracking
   */
  startUsageTracking() {
    // Clean up old data periodically
    setInterval(() => {
      this.cleanupOldData();
    }, 3600000); // Every hour
  }

  /**
   * Clean up old usage data
   */
  cleanupOldData() {
    const cutoff = Date.now() - (7 * 24 * 60 * 60 * 1000); // 7 days ago

    // Clean old access patterns
    for (const [key, pattern] of this.accessPatterns.entries()) {
      if (pattern.lastAccess < cutoff) {
        this.accessPatterns.delete(key);
      }
    }

    // Clean old user usage data
    for (const [userId, usage] of this.usageTracker.entries()) {
      if (usage.lastActivity < cutoff) {
        this.usageTracker.delete(userId);
      }
    }

    console.log('🧹 Cleaned up old usage tracking data');
  }

  /**
   * Get warming statistics
   */
  getWarmingStats() {
    return {
      ...this.warmingStats,
      accessPatterns: this.accessPatterns.size,
      activeUsers: this.usageTracker.size,
      popularTemplates: this.getPopularAccessPatterns('templates').slice(0, 5),
      strategies: Object.keys(this.strategies).filter(key => this.strategies[key].enabled)
    };
  }

  /**
   * Health check for warming service
   */
  async healthCheck() {
    try {
      const testItem = {
        name: 'health-check-warming',
        namespace: 'userData',
        data: { test: true, timestamp: Date.now() },
        identifier: 'health-check',
        ttl: 60
      };

      // Test warming
      await cacheService.set(testItem.namespace, testItem.identifier, testItem.data, testItem.ttl);
      const retrieved = await cacheService.get(testItem.namespace, testItem.identifier);

      // Cleanup
      await cacheService.delete(testItem.namespace, testItem.identifier);

      return {
        status: retrieved !== null ? 'healthy' : 'unhealthy',
        initialized: this.initialized,
        testPassed: retrieved !== null,
        stats: this.getWarmingStats()
      };

    } catch (error) {
      return {
        status: 'unhealthy',
        initialized: this.initialized,
        error: error.message,
        stats: this.getWarmingStats()
      };
    }
  }

  /**
   * Close cache warming service
   */
  async close() {
    try {
      this.initialized = false;
      console.log('✅ Cache Warming Service closed');
    } catch (error) {
      console.error('❌ Error closing Cache Warming Service:', error.message);
      throw error;
    }
  }
}

// Create singleton instance
const cacheWarmingService = new CacheWarmingService();

export default cacheWarmingService;
export { CacheWarmingService };