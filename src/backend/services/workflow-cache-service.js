/**
 * Workflow Cache Service
 * Specialized caching service for workflow templates and related data
 * Week 5-6 Phase 2 - Redis Caching Layer
 */

import cacheService from './redis-cache-service.js';
import { db, dbHelpers } from '../../database/config/database.js';

class WorkflowCacheService {
  constructor() {
    this.initialized = false;
    this.cacheKeyPrefix = 'workflow';

    // Cache TTL settings for different workflow data types
    this.ttlSettings = {
      templates: 7200,        // 2 hours - templates rarely change
      activeWorkflows: 1800,   // 30 minutes - frequently accessed
      workflowSteps: 3600,     // 1 hour
      userWorkflows: 900,      // 15 minutes - user-specific
      workflowStats: 600,      // 10 minutes - analytics data
      recentEvents: 300,       // 5 minutes - real-time events
      templateCategories: 86400 // 24 hours - static data
    };

    // Cache invalidation patterns
    this.invalidationPatterns = {
      userWorkflows: `user:*:workflows`,
      workflowSteps: `workflow:*:steps`,
      workflowEvents: `workflow:*:events`,
      templateUsage: `template:*:usage`
    };
  }

  /**
   * Initialize workflow cache service
   */
  async initialize() {
    try {
      await cacheService.initialize();
      this.initialized = true;
      console.log('✅ Workflow Cache Service initialized');

      // Warm up cache with frequently accessed data
      await this.warmupEssentialData();

      return true;
    } catch (error) {
      console.error('❌ Failed to initialize Workflow Cache Service:', error.message);
      this.initialized = false;
      throw error;
    }
  }

  /**
   * Get workflow templates with caching
   */
  async getTemplates(filters = {}) {
    const cacheKey = this.generateTemplateCacheKey(filters);

    return await cacheService.getOrSet(
      'workflowTemplates',
      cacheKey,
      async () => {
        try {
          let query = `
            SELECT
              id,
              name,
              description,
              template_key,
              steps,
              default_config,
              category,
              is_active,
              created_at,
              updated_at,
              (SELECT COUNT(*) FROM workflows WHERE template_id = workflow_templates.id) as usage_count
            FROM workflow_templates
            WHERE is_active = true
          `;

          const params = [];
          let paramIndex = 1;

          if (filters.category) {
            query += ` AND category = $${paramIndex++}`;
            params.push(filters.category);
          }

          if (filters.search) {
            query += ` AND (name ILIKE $${paramIndex++} OR description ILIKE $${paramIndex++})`;
            params.push(`%${filters.search}%`, `%${filters.search}%`);
          }

          query += ` ORDER BY usage_count DESC, name`;

          if (filters.limit) {
            query += ` LIMIT $${paramIndex++}`;
            params.push(filters.limit);
          }

          const result = await db.query(query, params);

          // Add computed fields
          const templates = result.rows.map(template => ({
            ...template,
            complexity: this.calculateComplexity(template.steps),
            estimatedDuration: this.estimateDuration(template.steps),
            popular: template.usage_count > 10
          }));

          return templates;
        } catch (error) {
          console.error('❌ Error fetching workflow templates:', error.message);
          throw error;
        }
      },
      this.ttlSettings.templates
    );
  }

  /**
   * Get single workflow template by ID
   */
  async getTemplate(templateId) {
    return await cacheService.getOrSet(
      'workflowTemplates',
      `template:${templateId}`,
      async () => {
        try {
          const template = await dbHelpers.findById('workflow_templates', templateId);

          if (!template) {
            return null;
          }

          // Add computed fields
          return {
            ...template,
            complexity: this.calculateComplexity(template.steps),
            estimatedDuration: this.estimateDuration(template.steps),
            steps = template.steps.map((step, index) => ({
              ...step,
              order: index + 1,
              estimatedTime: this.estimateStepTime(step)
            }))
          };
        } catch (error) {
          console.error(`❌ Error fetching template ${templateId}:`, error.message);
          throw error;
        }
      },
      this.ttlSettings.templates
    );
  }

  /**
   * Get workflow details with comprehensive caching
   */
  async getWorkflow(workflowId, userId = null) {
    const cacheKey = `workflow:${workflowId}:${userId || 'anonymous'}`;

    return await cacheService.getOrSet(
      'workflowData',
      cacheKey,
      async () => {
        try {
          // Get workflow with related data
          const result = await db.query(`
            SELECT
              w.*,
              t.name as template_name,
              t.description as template_description,
              u.username as created_by_username,
              u.full_name as created_by_full_name
            FROM workflows w
            LEFT JOIN workflow_templates t ON w.template_id = t.id
            LEFT JOIN users u ON w.created_by = u.id
            WHERE w.id = $1
          `, [workflowId]);

          if (result.rows.length === 0) {
            return null;
          }

          const workflow = result.rows[0];

          // Get workflow steps
          const stepsResult = await db.query(
            'SELECT * FROM workflow_steps WHERE workflow_id = $1 ORDER BY step_order',
            [workflowId]
          );

          // Get recent events
          const eventsResult = await db.query(
            'SELECT * FROM events WHERE workflow_id = $1 ORDER BY created_at DESC LIMIT 10',
            [workflowId]
          );

          // Calculate workflow metrics
          const metrics = await this.calculateWorkflowMetrics(workflowId);

          return {
            ...workflow,
            steps: stepsResult.rows,
            recentEvents: eventsResult.rows,
            metrics,
            stepsCount: stepsResult.rows.length
          };
        } catch (error) {
          console.error(`❌ Error fetching workflow ${workflowId}:`, error.message);
          throw error;
        }
      },
      this.ttlSettings.activeWorkflows
    );
  }

  /**
   * Get user workflows with caching
   */
  async getUserWorkflows(userId, filters = {}) {
    const cacheKey = this.generateUserWorkflowsCacheKey(userId, filters);

    return await cacheService.getOrSet(
      'userData',
      cacheKey,
      async () => {
        try {
          let query = `
            SELECT
              w.*,
              t.name as template_name,
              t.category,
              (SELECT COUNT(*) FROM workflow_steps WHERE workflow_id = w.id) as steps_count
            FROM workflows w
            LEFT JOIN workflow_templates t ON w.template_id = t.id
            WHERE w.created_by = $1
          `;

          const params = [userId];
          let paramIndex = 2;

          if (filters.status) {
            query += ` AND w.status = $${paramIndex++}`;
            params.push(filters.status);
          }

          if (filters.template_key) {
            query += ` AND w.template_key = $${paramIndex++}`;
            params.push(filters.template_key);
          }

          query += ` ORDER BY w.created_at DESC`;

          if (filters.limit) {
            query += ` LIMIT $${paramIndex++}`;
            params.push(filters.limit);
          }

          if (filters.offset) {
            query += ` OFFSET $${paramIndex++}`;
            params.push(filters.offset);
          }

          const result = await db.query(query, params);

          // Get total count for pagination
          const countQuery = `
            SELECT COUNT(*) as total
            FROM workflows w
            WHERE w.created_by = $1
            ${filters.status ? ` AND w.status = $2` : ''}
            ${filters.template_key ? ` AND w.template_key = $${filters.status ? 3 : 2}` : ''}
          `;

          const countParams = [userId];
          if (filters.status) countParams.push(filters.status);
          if (filters.template_key) countParams.push(filters.template_key);

          const countResult = await db.query(countQuery, countParams);

          return {
            workflows: result.rows,
            pagination: {
              total: parseInt(countResult.rows[0].total),
              page: Math.floor((filters.offset || 0) / (filters.limit || 20)) + 1,
              limit: filters.limit || 20
            }
          };
        } catch (error) {
          console.error(`❌ Error fetching user workflows for ${userId}:`, error.message);
          throw error;
        }
      },
      this.ttlSettings.userWorkflows
    );
  }

  /**
   * Cache workflow after creation
   */
  async cacheWorkflowAfterCreation(workflowData) {
    try {
      const workflowId = workflowData.id;
      const userId = workflowData.created_by;

      // Cache the new workflow
      await cacheService.set('workflowData', `workflow:${workflowId}`, workflowData, this.ttlSettings.activeWorkflows);

      // Invalidate user workflows cache
      await this.invalidateUserWorkflowsCache(userId);

      // Update template usage cache
      if (workflowData.template_key) {
        await this.incrementTemplateUsage(workflowData.template_key);
      }

      console.log(`✅ Cached workflow ${workflowId} after creation`);
      return true;
    } catch (error) {
      console.error(`❌ Error caching workflow after creation:`, error.message);
      return false;
    }
  }

  /**
   * Cache workflow after update
   */
  async cacheWorkflowAfterUpdate(workflowId, workflowData, userId) {
    try {
      // Update main workflow cache
      await cacheService.set('workflowData', `workflow:${workflowId}`, workflowData, this.ttlSettings.activeWorkflows);

      // Invalidate user workflows cache
      await this.invalidateUserWorkflowsCache(userId);

      // Invalidate workflow-specific caches
      await cacheService.delete('workflowData', `workflow:${workflowId}:steps`);
      await cacheService.delete('workflowData', `workflow:${workflowId}:events`);

      console.log(`✅ Updated cache for workflow ${workflowId}`);
      return true;
    } catch (error) {
      console.error(`❌ Error updating workflow cache:`, error.message);
      return false;
    }
  }

  /**
   * Invalidate workflow-related caches
   */
  async invalidateWorkflowCaches(workflowId, userId = null) {
    try {
      const patterns = [
        `workflow:${workflowId}`,
        `workflow:${workflowId}:*`
      ];

      for (const pattern of patterns) {
        await cacheService.deletePattern('workflowData', pattern);
      }

      if (userId) {
        await this.invalidateUserWorkflowsCache(userId);
      }

      console.log(`🗑️ Invalidated caches for workflow ${workflowId}`);
      return true;
    } catch (error) {
      console.error(`❌ Error invalidating workflow caches:`, error.message);
      return false;
    }
  }

  /**
   * Invalidate user workflows cache
   */
  async invalidateUserWorkflowsCache(userId) {
    try {
      await cacheService.deletePattern('userData', `user:${userId}:workflows:*`);
      console.log(`🗑️ Invalidated workflows cache for user ${userId}`);
      return true;
    } catch (error) {
      console.error(`❌ Error invalidating user workflows cache:`, error.message);
      return false;
    }
  }

  /**
   * Get workflow statistics with caching
   */
  async getWorkflowStats(timeframe = '24h') {
    return await cacheService.getOrSet(
      'workflowData',
      `stats:${timeframe}`,
      async () => {
        try {
          let timeCondition = '';
          switch (timeframe) {
            case '1h':
              timeCondition = "created_at >= NOW() - INTERVAL '1 hour'";
              break;
            case '24h':
              timeCondition = "created_at >= NOW() - INTERVAL '24 hours'";
              break;
            case '7d':
              timeCondition = "created_at >= NOW() - INTERVAL '7 days'";
              break;
            case '30d':
              timeCondition = "created_at >= NOW() - INTERVAL '30 days'";
              break;
            default:
              timeCondition = "created_at >= NOW() - INTERVAL '24 hours'";
          }

          const statsQuery = `
            SELECT
              COUNT(*) as total_workflows,
              COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
              COUNT(CASE WHEN status = 'running' THEN 1 END) as running,
              COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
              COUNT(CASE WHEN status = 'waiting_for_human' THEN 1 END) as waiting_human,
              AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) as avg_completion_time
            FROM workflows
            WHERE ${timeCondition}
          `;

          const result = await db.query(statsQuery);
          const stats = result.rows[0];

          // Get template usage stats
          const templateStatsQuery = `
            SELECT
              t.template_key,
              t.name,
              COUNT(w.id) as usage_count,
              AVG(CASE WHEN w.status = 'completed' THEN 1 ELSE 0 END) * 100 as success_rate
            FROM workflow_templates t
            LEFT JOIN workflows w ON t.id = w.template_id AND ${timeCondition}
            WHERE t.is_active = true
            GROUP BY t.id, t.template_key, t.name
            ORDER BY usage_count DESC
            LIMIT 10
          `;

          const templateResult = await db.query(templateStatsQuery);

          return {
            ...stats,
            timeframe,
            popularTemplates: templateResult.rows,
            avgCompletionTime: stats.avg_completion_time ? Math.round(stats.avg_completion_time) : null
          };
        } catch (error) {
          console.error('❌ Error fetching workflow stats:', error.message);
          throw error;
        }
      },
      this.ttlSettings.workflowStats
    );
  }

  /**
   * Warm up essential cache data
   */
  async warmupEssentialData() {
    try {
      console.log('🔥 Warming up workflow cache...');

      const warmupData = [];

      // Cache popular templates
      const popularTemplates = await this.getTemplates({ limit: 10 });
      for (const template of popularTemplates) {
        warmupData.push({
          namespace: 'workflowTemplates',
          identifier: `template:${template.id}`,
          data: template,
          ttl: this.ttlSettings.templates
        });
      }

      // Cache workflow stats
      const stats = await this.getWorkflowStats('24h');
      warmupData.push({
        namespace: 'workflowData',
        identifier: 'stats:24h',
        data: stats,
        ttl: this.ttlSettings.workflowStats
      });

      // Cache template categories
      const categories = await this.getTemplateCategories();
      warmupData.push({
        namespace: 'workflowTemplates',
        identifier: 'categories',
        data: categories,
        ttl: this.ttlSettings.templateCategories
      });

      const results = await cacheService.warmCache(warmupData);
      console.log(`✅ Warmed up cache: ${results.successful}/${results.total} items`);

      return results;
    } catch (error) {
      console.error('❌ Error warming up cache:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get template categories
   */
  async getTemplateCategories() {
    try {
      const result = await db.query(`
        SELECT DISTINCT category, COUNT(*) as template_count
        FROM workflow_templates
        WHERE is_active = true AND category IS NOT NULL
        GROUP BY category
        ORDER BY template_count DESC
      `);

      return result.rows;
    } catch (error) {
      console.error('❌ Error fetching template categories:', error.message);
      return [];
    }
  }

  /**
   * Helper methods
   */
  generateTemplateCacheKey(filters) {
    const key = JSON.stringify(filters);
    return Buffer.from(key).toString('base64');
  }

  generateUserWorkflowsCacheKey(userId, filters) {
    const key = `user:${userId}:workflows:${JSON.stringify(filters)}`;
    return Buffer.from(key).toString('base64');
  }

  calculateComplexity(steps) {
    if (!steps || !Array.isArray(steps)) return 'simple';

    const stepCount = steps.length;
    if (stepCount <= 3) return 'simple';
    if (stepCount <= 6) return 'intermediate';
    return 'advanced';
  }

  estimateDuration(steps) {
    if (!steps || !Array.isArray(steps)) return '5 minutes';

    const baseTime = 5; // minutes
    const stepTime = steps.length * 2; // 2 minutes per step
    const estimated = baseTime + stepTime;

    if (estimated < 30) return `${estimated} minutes`;
    if (estimated < 60) return `${estimated} minutes`;
    return `${Math.round(estimated / 60)} hours`;
  }

  estimateStepTime(step) {
    // Estimate time for individual step based on type
    const stepTimes = {
      'data_input': 2,
      'analysis': 5,
      'decision': 3,
      'human_review': 15,
      'approval': 10,
      'notification': 1
    };

    return stepTimes[step.type] || 3; // Default 3 minutes
  }

  async calculateWorkflowMetrics(workflowId) {
    try {
      const result = await db.query(`
        SELECT
          COUNT(*) as total_events,
          MAX(created_at) as last_activity,
          COUNT(CASE WHEN event_type = 'error' THEN 1 END) as error_count
        FROM events
        WHERE workflow_id = $1
      `, [workflowId]);

      const metrics = result.rows[0];

      return {
        totalEvents: parseInt(metrics.total_events),
        lastActivity: metrics.last_activity,
        errorCount: parseInt(metrics.error_count),
        hasErrors: parseInt(metrics.error_count) > 0
      };
    } catch (error) {
      console.error(`❌ Error calculating metrics for workflow ${workflowId}:`, error.message);
      return {
        totalEvents: 0,
        lastActivity: null,
        errorCount: 0,
        hasErrors: false
      };
    }
  }

  async incrementTemplateUsage(templateKey) {
    try {
      await cacheService.increment('workflowTemplates', `usage:${templateKey}`, 1);
    } catch (error) {
      // Silently ignore usage tracking errors
    }
  }

  /**
   * Get cache service statistics
   */
  async getCacheStats() {
    const workflowStats = await cacheService.getStats('workflowTemplates');
    const userStats = await cacheService.getStats('userData');
    const generalStats = await cacheService.getStats('workflowData');

    return {
      workflowTemplates: workflowStats,
      userData: userStats,
      workflowData: generalStats,
      initialized: this.initialized
    };
  }

  /**
   * Close workflow cache service
   */
  async close() {
    try {
      this.initialized = false;
      console.log('✅ Workflow Cache Service closed');
    } catch (error) {
      console.error('❌ Error closing Workflow Cache Service:', error.message);
      throw error;
    }
  }
}

// Create singleton instance
const workflowCacheService = new WorkflowCacheService();

export default workflowCacheService;
export { WorkflowCacheService };