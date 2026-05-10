/**
 * Deadline watcher runner — bootstrap-style entry point that wires the
 * watcher service against composed dependencies.
 *
 * Usage:
 *   import { startDeadlineWatcher } from '.../jobs/deadline-watcher-runner.js';
 *   const watcher = startDeadlineWatcher({
 *     pendingStepRepository,
 *     escalateOverdueStep,
 *     clock,
 *     intervalMs: 5000,
 *     logger,
 *   });
 *   // ...later
 *   await watcher.stop();
 */
import { start as startWatcher } from '../../application/services/deadline-watcher.js';

export function startDeadlineWatcher({
  pendingStepRepository,
  escalateOverdueStep,
  clock,
  intervalMs = 5000,
  batchSize = 50,
  logger,
}) {
  if (!escalateOverdueStep) throw new Error('deadline-watcher-runner: escalateOverdueStep required');
  return startWatcher({
    intervalMs,
    batchSize,
    clock,
    pendingStepRepository,
    escalateUseCase: escalateOverdueStep,
    onError: (err, ctx) => {
      if (logger && typeof logger.error === 'function') {
        logger.error({ err, ctx }, 'deadline-watcher error');
      }
    },
  });
}
