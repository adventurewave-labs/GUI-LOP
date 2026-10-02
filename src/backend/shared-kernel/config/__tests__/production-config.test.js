/**
 * Production configuration audit (roadmap P6): production refuses to boot
 * with weak/placeholder secrets, missing state stores or dangerous settings;
 * the documented example stays in sync with the schema.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, configWarnings, getConfigSchema } from '../config-loader.js';

const SECRET = 'fa0183c8b2ceff94e95b694465eea8dc46a06f854565778df0a68081571b9aaa';
const prod = (over = {}) => ({
  NODE_ENV: 'production',
  JWT_SECRET: SECRET,
  DATABASE_URL: 'postgresql://u:p@db:5432/app',
  REDIS_URL: 'redis://cache:6379',
  CORS_ORIGINS: 'https://app.example.org',
  METRICS_TOKEN: 'm'.repeat(8) + 'Z9q7Lw2kP4', // 18 chars
  ...over,
});
const errorsOf = (env) => {
  try { loadConfig(env); return []; } catch (e) { return e.details.errors.map((x) => x.name); }
};

describe('NODE_ENV', () => {
  test.each(['prod', 'Production', 'staging', 'live'])('typo/unknown %p is rejected instead of silently running in non-production mode', (v) => {
    expect(() => loadConfig({ JWT_SECRET: 'x', NODE_ENV: v })).toThrow(/NODE_ENV must be one of development, test, production/);
  });
  test.each(['development', 'test', 'production'])('%p is accepted', (v) => {
    expect(() => loadConfig(v === 'production' ? prod() : { JWT_SECRET: 'x', NODE_ENV: v })).not.toThrow();
  });
});

describe('production invariants', () => {
  test('a complete, sane production config loads', () => {
    expect(errorsOf(prod())).toEqual([]);
  });

  test.each([
    ['short', 'short-secret'],
    ['the .env.example placeholder', 'change-me-to-a-256-bit-random-string'],
    ['a "your-…" placeholder', 'your-super-secret-jwt-key-goes-here-123'],
    ['a ci- prefixed value', 'ci-test-secret-not-used-in-prod-0000000'],
    ['low entropy', 'a'.repeat(40)],
  ])('JWT_SECRET that is %s is refused', (_l, secret) => {
    expect(errorsOf(prod({ JWT_SECRET: secret }))).toEqual(['JWT_SECRET']);
  });

  test('DATABASE_URL and REDIS_URL are required (in-memory fallbacks lose data / break across replicas)', () => {
    expect(errorsOf(prod({ DATABASE_URL: '', REDIS_URL: '' }))).toEqual(['DATABASE_URL', 'REDIS_URL']);
    expect(errorsOf(prod({ DATABASE_URL: '', REDIS_URL: '', ALLOW_EPHEMERAL_STATE: 'true' }))).toEqual([]);
  });

  test.each([
    [{ CORS_ORIGINS: '*' }, ['CORS_ORIGINS']],
    [{ CORS_ORIGINS: 'https://*.example.org' }, ['CORS_ORIGINS']],
    [{ CORS_ORIGINS: 'https://app.example.org,null' }, ['CORS_ORIGINS']],
    [{ BCRYPT_WORK_FACTOR: '4' }, ['BCRYPT_WORK_FACTOR']],
    [{ BCRYPT_WORK_FACTOR: '20' }, ['BCRYPT_WORK_FACTOR']],
    [{ METRICS_TOKEN: 'short' }, ['METRICS_TOKEN']],
    [{ JWT_ACCESS_TTL_SECONDS: '86400' }, ['JWT_ACCESS_TTL_SECONDS']],
    [{ JWT_ACCESS_TTL_SECONDS: '900', JWT_REFRESH_TTL_SECONDS: '600' }, ['JWT_REFRESH_TTL_SECONDS']],
    [{ AI_PROVIDER: 'anthropic' }, ['AI_API_KEY']],
    [{ RATE_LIMIT_MAX: '0' }, ['RATE_LIMIT_MAX']],
    [{ WS_ALLOW_HEADER_AUTH: 'true' }, ['WS_ALLOW_HEADER_AUTH']],
  ])('%p → refused (%p)', (over, names) => {
    expect(errorsOf(prod(over))).toEqual(names);
  });

  test('every problem is reported at once, and secrets are not echoed', () => {
    try {
      loadConfig(prod({ JWT_SECRET: 'change-me-to-a-256-bit-random-string', DATABASE_URL: '', CORS_ORIGINS: '*' }));
      throw new Error('should have thrown');
    } catch (e) {
      expect(e.details.errors.map((x) => x.name)).toEqual(['JWT_SECRET', 'DATABASE_URL', 'CORS_ORIGINS']);
      expect(e.message).not.toContain('change-me-to-a-256-bit-random-string');
    }
  });

  test('none of this applies outside production (dev/test stay frictionless)', () => {
    expect(() => loadConfig({ JWT_SECRET: 'x', NODE_ENV: 'development', CORS_ORIGINS: '*', BCRYPT_WORK_FACTOR: '4' })).not.toThrow();
    expect(() => loadConfig({ JWT_SECRET: 'x', NODE_ENV: 'test' })).not.toThrow();
  });
});

describe('configWarnings', () => {
  test('quiet for a well-configured production and for non-production', () => {
    expect(configWarnings(loadConfig(prod({ TRUST_PROXY: '1', AI_PROVIDER: 'openai', AI_API_KEY: 'k' })))).toEqual([]);
    expect(configWarnings(loadConfig({ JWT_SECRET: 'x' }))).toEqual([]);
  });

  test('flags settings that are allowed but risky', () => {
    const w = configWarnings(loadConfig(prod({
      TRUST_PROXY: 'true', LOG_LEVEL: 'debug', METRICS_TOKEN: '', CORS_ORIGINS: 'http://intranet.example,http://localhost:3000',
      DATABASE_URL: '', REDIS_URL: '', ALLOW_EPHEMERAL_STATE: 'true',
    }))).join('\n');
    for (const fragment of ['ALLOW_EPHEMERAL_STATE', 'TRUST_PROXY=true', 'LOG_LEVEL=debug', 'METRICS_TOKEN unset', 'plain-http', 'localhost origin', 'AI_PROVIDER=stub']) {
      expect(w).toContain(fragment);
    }
    expect(configWarnings(loadConfig(prod())).join('\n')).toContain('TRUST_PROXY=false');
  });
});

describe('.env.example stays in sync with the schema', () => {
  const example = fs.readFileSync(path.resolve(__dirname, '../../../../../.env.example'), 'utf8');
  const documented = new Set([...example.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]));
  // Not operator-facing: test-only knob and platform-injected values.
  const UNDOCUMENTED_OK = new Set(['BCRYPT_WORK_FACTOR_TEST', 'GIT_SHA', 'RAILWAY_GIT_COMMIT_SHA']);
  // Consumed by docker-compose, not by the app.
  const COMPOSE_ONLY = new Set(['POSTGRES_DB', 'POSTGRES_PASSWORD', 'POSTGRES_PORT', 'POSTGRES_USER', 'REDIS_PORT']);

  test('every setting the app reads is documented', () => {
    const missing = Object.keys(getConfigSchema()).filter((k) => !documented.has(k) && !UNDOCUMENTED_OK.has(k));
    expect(missing).toEqual([]);
  });

  test('nothing documented is unknown to the app', () => {
    const schema = new Set(Object.keys(getConfigSchema()));
    const unknown = [...documented].filter((k) => !schema.has(k) && !COMPOSE_ONLY.has(k));
    expect(unknown).toEqual([]);
  });

  test('the documented JWT_SECRET placeholder cannot be used in production', () => {
    const placeholder = example.match(/^JWT_SECRET=(.+)$/m)[1];
    expect(errorsOf(prod({ JWT_SECRET: placeholder }))).toEqual(['JWT_SECRET']);
  });
});
