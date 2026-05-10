/**
 * Deadline watcher.
 *
 * `start({ intervalMs, escalateUseCase, pendingStepRepository, clock,
 *          batchSize, onError })` returns a `{ stop, tick }` handle.
 *
 *   - `tick()` performs a single sweep: fetch overdue pending steps and
 *     invoke `escalateUseCase.execute` for each. Useful in tests.
 *   - `stop()` clears the polling timer and resolves once the in-flight
 *     tick (if any) settles.
 *
 * The watcher is deterministic in tests because it polls on a timer that
 * tests can replace with a manual driver via `tick()`.
 */
export function start({
  intervalMs = 5000,
  escalateUseCase,
  pendingStepRepository,
  clock,
  batchSize = 50,
  onError = () => {},
} = {}) {
  if (!escalateUseCase) throw new Error('deadline-watcher: escalateUseCase required');
  if (!pendingStepRepository) throw new Error('deadline-watcher: pendingStepRepository required');
  if (!clock) throw new Error('deadline-watcher: clock required');

  let timer = null;
  let stopped = false;
  let inFlight = null;

  async function tick() {
    if (stopped) return { processed: 0 };
    const now = clock.now();
    let overdue;
    try {
      overdue = await pendingStepRepository.findOverdue(now, batchSize);
    } catch (err) {
      onError(err, { phase: 'findOverdue' });
      return { processed: 0, error: err };
    }
    let processed = 0;
    for (const step of overdue) {
      if (stopped) break;
      try {
        await escalateUseCase.execute({
          workflowId: step.workflowId,
          stepId: step.stepId,
        });
        processed += 1;
      } catch (err) {
        onError(err, { workflowId: step.workflowId, stepId: step.stepId, phase: 'escalate' });
      }
    }
    return { processed };
  }

  function schedule() {
    if (stopped) return;
    timer = setTimeout(async () => {
      inFlight = tick().catch((err) => onError(err, { phase: 'tick' }));
      try {
        await inFlight;
      } finally {
        inFlight = null;
        schedule();
      }
    }, intervalMs);
    if (typeof timer.unref === 'function') timer.unref();
  }

  schedule();

  async function stop() {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (inFlight) {
      try { await inFlight; } catch (_) { /* ignore */ }
    }
  }

  return { stop, tick };
}
