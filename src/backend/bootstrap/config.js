/**
 * bootstrap/config — re-exports the shared-kernel config loader so the
 * composition root can `import { loadConfig } from './config.js'`.
 */
export { loadConfig, ConfigError, getConfigSchema } from '../shared-kernel/config/config-loader.js';
