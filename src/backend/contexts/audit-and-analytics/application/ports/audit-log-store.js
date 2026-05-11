/**
 * AuditLogStore — read-only port over the platform's `audit_logs` table.
 */

export class AuditLogStore {
  async query(_filter) { throw new Error('AuditLogStore.query is abstract'); }
}
