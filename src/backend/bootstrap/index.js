// @ts-check
/**
 * index.js — entry point for the v1 (DDD) HTTP server.
 *
 * Calls `bootstrap()` from `main.js`, listens on the configured port,
 * and wires graceful SIGTERM/SIGINT shutdown.
 *
 * This is the only file in the bootstrap tree allowed to use `console.log`;
 * everything else must go through the structured logger.
 */

import { bootstrap } from './main.js';

async function main() {
  const { httpServer, config, shutdown, ctx } = await bootstrap();

  await new Promise(/** @param {(v?: unknown) => void} resolve */ (resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(config.PORT, () => {
      ctx.logger.info(`GUI-LOP v1 listening on http://localhost:${config.PORT}`);
      resolve();
    });
  });

  let shuttingDown = false;
  async function gracefulShutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}, shutting down gracefully...`);
    try {
      // Drain delay + in-flight budget must fit inside SHUTDOWN_TIMEOUT_MS,
      // which itself must sit below terminationGracePeriodSeconds.
      const inFlightTimeoutMs = Math.max(
        1000,
        config.SHUTDOWN_TIMEOUT_MS - config.SHUTDOWN_DRAIN_DELAY_MS - 3000,
      );
      await Promise.race([
        shutdown({ drainDelayMs: config.SHUTDOWN_DRAIN_DELAY_MS, inFlightTimeoutMs }),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('shutdown timeout')), config.SHUTDOWN_TIMEOUT_MS);
        }),
      ]);
      console.log('Shutdown complete.');
      process.exit(0);
    } catch (err) {
      console.error('Forced shutdown:', err?.message ?? err);
      process.exit(1);
    }
  }

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

main().catch((err) => {
  console.error('Failed to start GUI-LOP v1:', err);
  process.exit(1);
});
