/**
 * WorkflowTransition — value object recording one status change.
 * Append-only on the workflow aggregate.
 */
export class WorkflowTransition {
  constructor({ from, to, at, reason }) {
    this.from = from;
    this.to = to;
    this.at = at instanceof Date ? at : new Date(at);
    this.reason = reason ?? null;
    Object.freeze(this);
  }

  toJSON() {
    return {
      from: this.from,
      to: this.to,
      at: this.at.toISOString(),
      reason: this.reason,
    };
  }
}
