/**
 * Composition root — the single place permitted to wire infrastructure
 * implementations to application ports across all bounded contexts.
 *
 * Phase 0 wires only the shared kernel; subsequent phases extend this
 * module to construct context-specific use cases and routers.
 */
import { loadConfig } from './config.js';
import { systemClock } from '../shared-kernel/infrastructure/system-clock.js';
import { uuidGenerator } from '../shared-kernel/infrastructure/uuid-generator.js';
import { createPgUnitOfWork } from '../shared-kernel/infrastructure/pg-unit-of-work.js';
import { createPgOutboxRepository } from '../shared-kernel/infrastructure/pg-outbox-repository.js';
import { createLogger } from '../shared-kernel/infrastructure/logger.js';

/**
 * Build the shared-kernel container. Returns the wired primitives every
 * bounded context will need; later phases extend the returned object.
 *
 * @returns {Promise<{
 *   config: object,
 *   logger: object,
 *   clock: { now: () => Date },
 *   idGen: { newId: () => string },
 *   pool: any | null,
 *   redis: null,
 *   uow: { run: Function } | null,
 *   outbox: object | null,
 *   shutdown: () => Promise<void>,
 * }>}
 */
export async function bootstrap() {
  const config = loadConfig(process.env);
  const logger = createLogger({ level: config.LOG_LEVEL });
  const clock = systemClock;
  const idGen = uuidGenerator;

  let pool = null;
  let uow = null;
  let outbox = null;

  if (config.DATABASE_URL) {
    // Lazy import so unit tests / no-DB envs don't pay the cost.
    const pgModule = await import('pg');
    const Pool = pgModule.default?.Pool ?? pgModule.Pool;
    pool = new Pool({ connectionString: config.DATABASE_URL });
    uow = createPgUnitOfWork(pool);
    outbox = createPgOutboxRepository(pool);
    logger.info('shared-kernel: postgres pool initialised');
  } else {
    logger.warn('shared-kernel: DATABASE_URL not set; pool/uow/outbox are null');
  }

  /** Cleanly close infrastructure handles. */
  async function shutdown() {
    if (pool && typeof pool.end === 'function') {
      await pool.end();
    }
  }

  return {
    config,
    logger,
    clock,
    idGen,
    pool,
    redis: null,
    uow,
    outbox,
    shutdown,
  };
}
