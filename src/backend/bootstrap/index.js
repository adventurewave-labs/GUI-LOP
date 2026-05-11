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

  await new Promise((resolve, reject) => {
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
    // eslint-disable-next-line no-console
    console.log(`Received ${signal}, shutting down gracefully...`);
    try {
      await Promise.race([
        shutdown(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('shutdown timeout')), 10_000)),
      ]);
      // eslint-disable-next-line no-console
      console.log('Shutdown complete.');
      process.exit(0);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Forced shutdown:', err?.message ?? err);
      process.exit(1);
    }
  }

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start GUI-LOP v1:', err);
  process.exit(1);
});
