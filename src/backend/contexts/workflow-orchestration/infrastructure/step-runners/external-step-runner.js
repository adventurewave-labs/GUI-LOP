/**
 * Stub `ExternalStepRunner`. By default returns `{ deferred: true }`,
 * meaning the engine should pause and wait for an async callback to
 * `AdvanceWorkflow`.
 */
export class StubExternalStepRunner {
  constructor({ handler } = {}) {
    this._handler = handler;
  }

  async run({ step, context }) {
    if (this._handler) {
      try {
        return await this._handler(step, context);
      } catch (error) {
        return { error };
      }
    }
    return { deferred: true };
  }
}
