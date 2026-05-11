/**
 * ClassificationService — application-level port that exposes classification
 * as a first-class capability, distinct from `AIProvider.classify`. The
 * concrete implementation simply delegates to an `AIProvider`, but having a
 * dedicated port lets future contexts depend on classification without
 * pulling the larger `AIProvider` surface area.
 *
 * No consumers yet inside the UI Generation context; this is a forward-
 * looking port for ADR 0023.
 *
 * Contract:
 *
 *   classify({ input, labels, options? }): Promise<ClassificationResult>
 *     - Same shape as `AIProvider.classify`.
 *
 * The default implementation `AIProviderClassificationService` wraps an
 * `AIProvider` instance and forwards the call. It is intentionally tiny so
 * that swapping in a bespoke classifier (e.g. a local-only model) is a
 * one-class change.
 */
export class ClassificationService {
  // eslint-disable-next-line no-unused-vars
  async classify(_input) {
    throw new Error('ClassificationService.classify is abstract');
  }
}

/**
 * Default {@link ClassificationService} that proxies to an AIProvider.
 */
export class AIProviderClassificationService extends ClassificationService {
  /**
   * @param {{ aiProvider: import('./ai-provider.js').AIProvider }} deps
   */
  constructor({ aiProvider }) {
    super();
    if (!aiProvider) {
      throw new Error('AIProviderClassificationService requires aiProvider');
    }
    this._ai = aiProvider;
  }

  async classify(input) {
    return this._ai.classify(input);
  }
}
