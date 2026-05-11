/**
 * wire-audit-and-analytics.js — composition for the Audit & Analytics context.
 */
import { InMemoryAuditLogStore } from '../contexts/audit-and-analytics/infrastructure/persistence/inmemory-audit-log-store.js';
import { InMemoryEventStore } from '../contexts/audit-and-analytics/infrastructure/persistence/inmemory-event-store.js';
import { PgAuditLogStore } from '../contexts/audit-and-analytics/infrastructure/persistence/pg-audit-log-store.js';
import { PgEventStore } from '../contexts/audit-and-analytics/infrastructure/persistence/pg-event-store.js';
import { InMemoryStorage } from '../contexts/ui-generation/infrastructure/storage/inmemory-storage.js';

import { GetWorkflowTrailQuery } from '../contexts/audit-and-analytics/application/queries/get-workflow-trail.js';
import { GetAuditTrailQuery } from '../contexts/audit-and-analytics/application/queries/get-audit-trail.js';
import { GetWorkflowAnalyticsQuery } from '../contexts/audit-and-analytics/application/queries/get-workflow-analytics.js';
import { GetUserActivityQuery } from '../contexts/audit-and-analytics/application/queries/get-user-activity.js';
import { GetActiveWorkflowsQuery } from '../contexts/audit-and-analytics/application/queries/get-active-workflows.js';
import { ExportComplianceDataCommand } from '../contexts/audit-and-analytics/application/commands/export-compliance-data.js';
import { RebuildProjectionCommand } from '../contexts/audit-and-analytics/application/commands/rebuild-projection.js';
import { ProjectionUpdater } from '../contexts/audit-and-analytics/application/event-handlers/projection-updater.js';

import { createAuditRouter } from '../contexts/audit-and-analytics/interfaces/http/audit-router.js';
import { createAnalyticsRouter } from '../contexts/audit-and-analytics/interfaces/http/analytics-router.js';
import { createDashboardRouter } from '../contexts/audit-and-analytics/interfaces/http/dashboard-router.js';

export function wireAuditAndAnalytics({
  pool,
  clock,
  idGen,
  objectStorage,
  logger,
}) {
  const eventStore = pool ? new PgEventStore(pool) : new InMemoryEventStore();
  const auditLogStore = pool ? new PgAuditLogStore(pool) : new InMemoryAuditLogStore();
  const storage = objectStorage ?? new InMemoryStorage();
  const projectionUpdater = new ProjectionUpdater();

  const useCases = {
    getWorkflowTrail: new GetWorkflowTrailQuery({ eventStore, auditLogStore }),
    getAuditTrail: new GetAuditTrailQuery({ eventStore, auditLogStore }),
    getWorkflowAnalytics: new GetWorkflowAnalyticsQuery({ pool }),
    getUserActivity: new GetUserActivityQuery({ pool }),
    getActiveWorkflows: new GetActiveWorkflowsQuery({ pool }),
    exportComplianceData: new ExportComplianceDataCommand({
      eventStore,
      auditLogStore,
      objectStorage: storage,
      idGenerator: idGen,
      clock,
    }),
    rebuildProjection: new RebuildProjectionCommand({
      eventStore,
      projectionUpdater,
    }),
  };

  const routers = {
    audit: createAuditRouter({
      getWorkflowTrailQuery: useCases.getWorkflowTrail,
      getAuditTrailQuery: useCases.getAuditTrail,
      exportComplianceDataCommand: useCases.exportComplianceData,
    }),
    analytics: createAnalyticsRouter({
      getWorkflowAnalyticsQuery: useCases.getWorkflowAnalytics,
      getUserActivityQuery: useCases.getUserActivity,
    }),
    dashboards: createDashboardRouter({
      getActiveWorkflowsQuery: useCases.getActiveWorkflows,
    }),
  };

  if (logger) {
    logger.info(
      `audit-and-analytics wired (${pool ? 'pg' : 'in-memory'} stores)`,
    );
  }

  return {
    useCases,
    routers,
    projectionUpdater,
    stores: { eventStore, auditLogStore },
  };
}
