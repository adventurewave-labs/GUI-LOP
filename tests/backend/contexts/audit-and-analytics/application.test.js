/**
 * Audit & Analytics context — application tests with in-memory adapters.
 */

import { GetWorkflowTrailQuery } from '../../../../src/backend/contexts/audit-and-analytics/application/queries/get-workflow-trail.js';
import { GetAuditTrailQuery } from '../../../../src/backend/contexts/audit-and-analytics/application/queries/get-audit-trail.js';
import { ExportComplianceDataCommand } from '../../../../src/backend/contexts/audit-and-analytics/application/commands/export-compliance-data.js';
import { RebuildProjectionCommand } from '../../../../src/backend/contexts/audit-and-analytics/application/commands/rebuild-projection.js';
import { ProjectionUpdater } from '../../../../src/backend/contexts/audit-and-analytics/application/event-handlers/projection-updater.js';
import { GetWorkflowAnalyticsQuery } from '../../../../src/backend/contexts/audit-and-analytics/application/queries/get-workflow-analytics.js';
import { GetUserActivityQuery } from '../../../../src/backend/contexts/audit-and-analytics/application/queries/get-user-activity.js';
import { GetActiveWorkflowsQuery } from '../../../../src/backend/contexts/audit-and-analytics/application/queries/get-active-workflows.js';

import { InMemoryEventStore } from '../../../../src/backend/contexts/audit-and-analytics/infrastructure/persistence/inmemory-event-store.js';
import { InMemoryAuditLogStore } from '../../../../src/backend/contexts/audit-and-analytics/infrastructure/persistence/inmemory-audit-log-store.js';
import { InMemoryStorage } from '../../../../src/backend/contexts/ui-generation/infrastructure/storage/inmemory-storage.js';
import { FrozenClock, FixedIdGenerator } from '../../../../src/backend/shared-kernel/infrastructure/test-fixtures.js';
const seedEvents = () => [
  {
    id: 'e1',
    type: 'workflow.started',
    aggregate_type: 'Workflow',
    aggregate_id: 'wf-1',
    payload: { name: 'demo' },
    occurred_at: '2026-05-09T08:00:00.000Z'
  },
  {
    id: 'e2',
    type: 'workflow.completed',
    aggregate_type: 'Workflow',
    aggregate_id: 'wf-1',
    payload: {},
    occurred_at: '2026-05-09T09:00:00.000Z'
  },
  {
    id: 'e3',
    type: 'user.signed_in',
    aggregate_type: 'User',
    aggregate_id: 'u-1',
    occurred_at: '2026-05-09T07:00:00.000Z'
  }
];

const seedLogs = () => [
  {
    id: 'a1',
    actor_id: 'u-1',
    action: 'WORKFLOW_STARTED',
    aggregate_type: 'Workflow',
    aggregate_id: 'wf-1',
    created_at: '2026-05-09T08:00:01.000Z'
  }
];

describe('GetWorkflowTrail', () => {
  it('merges events and audit logs in chronological order for a workflow', async () => {
    const ev = new InMemoryEventStore(seedEvents());
    const lg = new InMemoryAuditLogStore(seedLogs());
    const q = new GetWorkflowTrailQuery({ eventStore: ev, auditLogStore: lg });
    const trail = await q.execute({ workflowId: 'wf-1' });
    expect(trail.workflowId).toBe('wf-1');
    expect(trail.items.length).toBe(3); // 2 events + 1 log
    const ats = trail.items.map((i) => i.at);
    const sorted = [...ats].sort();
    expect(ats).toEqual(sorted);
  });
});

describe('GetAuditTrail (generic)', () => {
  it('returns events and logs for an aggregate', async () => {
    const ev = new InMemoryEventStore(seedEvents());
    const lg = new InMemoryAuditLogStore(seedLogs());
    const q = new GetAuditTrailQuery({ eventStore: ev, auditLogStore: lg });
    const trail = await q.execute({ aggregateType: 'Workflow', aggregateId: 'wf-1' });
    expect(trail.events.length).toBe(2);
    expect(trail.logs.length).toBe(1);
  });
});

describe('ExportComplianceData', () => {
  it('writes a JSON archive and returns the URL', async () => {
    const ev = new InMemoryEventStore(seedEvents());
    const lg = new InMemoryAuditLogStore(seedLogs());
    const storage = new InMemoryStorage();
    const clock = new FrozenClock(new Date('2026-05-10T00:00:00.000Z'));
    const ids = new FixedIdGenerator(['exp-1']);

    const cmd = new ExportComplianceDataCommand({
      eventStore: ev,
      auditLogStore: lg,
      objectStorage: storage,
      idGenerator: ids,
      clock
    });
    const out = await cmd.execute({ aggregateType: 'Workflow', aggregateId: 'wf-1' });
    expect(out.isOk()).toBe(true);
    expect(out.value.url).toBe('/ui-documents/compliance-exports/exp-1.json');
    const stored = await storage.get('compliance-exports/exp-1.json');
    const parsed = JSON.parse(stored);
    expect(parsed.events.length).toBe(2);
    expect(parsed.logs.length).toBe(1);
  });
});

describe('RebuildProjection', () => {
  it('streams events through a projection updater', async () => {
    const ev = new InMemoryEventStore(seedEvents());
    const updater = new ProjectionUpdater();
    const seenTypes = [];
    updater.on('workflow.started', async (e) => { seenTypes.push(e.type); });
    updater.on('workflow.completed', async (e) => { seenTypes.push(e.type); });

    const cmd = new RebuildProjectionCommand({ eventStore: ev, projectionUpdater: updater });
    const out = await cmd.execute({ aggregateType: 'Workflow', aggregateId: 'wf-1' });
    expect(out.isOk()).toBe(true);
    expect(out.value.processed).toBe(2);
    expect(seenTypes).toEqual(['workflow.started', 'workflow.completed']);
    expect(updater.processedCount).toBe(2);
  });
});

describe('SQL view-backed queries fall back gracefully when views are missing', () => {
  const fakePool = {
    async query() {
      const err = new Error('relation "x" does not exist');
      err.code = '42P01';
      throw err;
    }
  };

  it('GetWorkflowAnalyticsQuery returns []', async () => {
    const q = new GetWorkflowAnalyticsQuery({ pool: fakePool });
    expect(await q.execute()).toEqual([]);
  });

  it('GetUserActivityQuery returns []', async () => {
    const q = new GetUserActivityQuery({ pool: fakePool });
    expect(await q.execute({ userId: 'u-1' })).toEqual([]);
  });

  it('GetActiveWorkflowsQuery returns []', async () => {
    const q = new GetActiveWorkflowsQuery({ pool: fakePool });
    expect(await q.execute()).toEqual([]);
  });
});
