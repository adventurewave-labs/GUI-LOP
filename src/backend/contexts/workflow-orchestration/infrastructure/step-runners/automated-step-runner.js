/**
 * Stub `AutomatedStepRunner`. Echoes the current workflow context as
 * the step output. Real implementations dispatch to AI providers,
 * domain services, etc.
 */
export class StubAutomatedStepRunner {
  constructor({ handler } = {}) {
    this._handler = handler;
  }

  async run({ step, context }) {
    if (this._handler) {
      try {
        const output = await this._handler(step, context);
        return { output: output ?? { echoed: context } };
      } catch (error) {
        return { error };
      }
    }
    return { output: { echoed: context, step: step.name } };
  }
}
