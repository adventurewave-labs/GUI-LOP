import { UIDocumentRepository } from '../../application/ports/ui-document-repository.js';
import { UIDocument } from '../../domain/ui-document.js';

function rowToDoc(r) {
  if (!r) return null;
  return new UIDocument({
    id: r.id,
    workflowId: r.workflow_id,
    stepId: r.step_id,
    url: r.url,
    contentRef: r.content_ref,
    strategy: r.strategy,
    version: r.version,
    generatedAt:
      r.generated_at instanceof Date ? r.generated_at.toISOString() : r.generated_at
  });
}

export class PgUIDocumentRepository extends UIDocumentRepository {
  constructor(pool) {
    super();
    this._pool = pool;
  }

  async save(doc) {
    await this._pool.query(
      `INSERT INTO ui_documents
        (id, workflow_id, step_id, url, content_ref, strategy, version, generated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET
         url        = EXCLUDED.url,
         content_ref = EXCLUDED.content_ref,
         strategy   = EXCLUDED.strategy,
         version    = EXCLUDED.version`,
      [
        doc.id,
        doc.workflowId,
        doc.stepId,
        doc.url,
        doc.contentRef,
        doc.strategy,
        doc.version,
        doc.generatedAt
      ]
    );
  }

  async findById(id) {
    const { rows } = await this._pool.query(
      `SELECT id, workflow_id, step_id, url, content_ref, strategy, version, generated_at
         FROM ui_documents WHERE id = $1`,
      [id]
    );
    return rowToDoc(rows[0]);
  }

  async findByStep(workflowId, stepId) {
    const { rows } = await this._pool.query(
      `SELECT id, workflow_id, step_id, url, content_ref, strategy, version, generated_at
         FROM ui_documents
        WHERE workflow_id = $1 AND step_id = $2
        ORDER BY generated_at DESC`,
      [workflowId, stepId]
    );
    return rows.map(rowToDoc);
  }
}
