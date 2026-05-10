/**
 * Tiny structured logger — emits one JSON line per record on stdout/stderr.
 * Intentionally dependency-free; replace with pino if/when needed.
 */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

function levelEnabled(current, requested) {
  return (LEVELS[requested] ?? 0) >= (LEVELS[current] ?? LEVELS.info);
}

function emit(level, msg, fields) {
  const record = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...(fields && typeof fields === 'object' ? fields : {}),
  };
  const line = JSON.stringify(record);
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  stream.write(line + '\n');
}

/**
 * Create a logger bound to a minimum level and optional default fields.
 * @param {{ level?: string, base?: object }} [opts]
 */
export function createLogger(opts = {}) {
  const level = opts.level ?? process.env.LOG_LEVEL ?? 'info';
  const base = opts.base ?? {};
  const log = (lvl, msg, fields) => {
    if (!levelEnabled(level, lvl)) return;
    emit(lvl, msg, { ...base, ...(fields || {}) });
  };
  return {
    level,
    debug: (msg, fields) => log('debug', msg, fields),
    info: (msg, fields) => log('info', msg, fields),
    warn: (msg, fields) => log('warn', msg, fields),
    error: (msg, fields) => log('error', msg, fields),
    child: (extra) => createLogger({ level, base: { ...base, ...extra } }),
  };
}
