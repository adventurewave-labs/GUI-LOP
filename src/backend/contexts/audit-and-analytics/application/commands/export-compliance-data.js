/**
 * ExportComplianceData — produces a JSON archive of the audit/event trail for
 * a given aggregate, persisted via the object-storage port and returning the
 * URL.
 */

import { randomUUID } from 'crypto';
import { Result } from '../../../../shared-kernel/domain/result.js';
export class ExportComplianceDataCommand {
  constructor({ eventStore, auditLogStore, objectStorage, idGenerator, clock }) {
    this._events = eventStore;
    this._logs = auditLogStore;
    this._storage = objectStorage;
    this._ids = idGenerator;
    this._clock = clock;
  }

  async execute({ aggregateType, aggregateId, range } = {}) {
    const id = this._ids?.next?.() ?? randomUUID();
    const [events, logs] = await Promise.all([
      this._events.query({ aggregateType, aggregateId, range }),
      this._logs.query({ aggregateType, aggregateId, range })
    ]);

    const generatedAt = this._nowIso();
    const archive = {
      id,
      aggregateType,
      aggregateId,
      generatedAt,
      events,
      logs
    };

    const key = `compliance-exports/${id}.json`;
    await this._storage.put(key, JSON.stringify(archive, null, 2));
    const url = this._storage.getUrl(key);

    return Result.ok({ id, url, generatedAt, events: events.length, logs: logs.length });
  }

  _nowIso() {
    if (this._clock?.nowIso) return this._clock.nowIso();
    if (this._clock?.now) return new Date(this._clock.now()).toISOString();
    return new Date().toISOString();
  }
}
