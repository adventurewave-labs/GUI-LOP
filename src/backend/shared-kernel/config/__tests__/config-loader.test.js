import { loadConfig, ConfigError } from '../config-loader.js';

const minimal = () => ({
  JWT_SECRET: 'a-very-long-test-secret',
});

describe('loadConfig', () => {
  test('happy path applies defaults', () => {
    const cfg = loadConfig(minimal());
    expect(cfg.NODE_ENV).toBe('development');
    expect(cfg.PORT).toBe(3001);
    expect(cfg.JWT_SECRET).toBe('a-very-long-test-secret');
    expect(cfg.JWT_ACCESS_TTL_SECONDS).toBe(900);
    expect(cfg.JWT_REFRESH_TTL_SECONDS).toBe(604800);
    expect(cfg.BCRYPT_WORK_FACTOR).toBe(12);
    expect(cfg.RATE_LIMIT_WINDOW_MS).toBe(900000);
    expect(cfg.RATE_LIMIT_MAX).toBe(100);
    expect(cfg.CORS_ORIGINS).toEqual(['http://localhost:3000']);
    expect(cfg.LOG_LEVEL).toBe('info');
    expect(cfg.OUTBOX_BATCH_SIZE).toBe(200);
    expect(cfg.BCRYPT_WORK_FACTOR_TEST).toBe(4);
  });

  test('NODE_ENV=test uses BCRYPT_WORK_FACTOR_TEST when no explicit override', () => {
    const cfg = loadConfig({ ...minimal(), NODE_ENV: 'test' });
    expect(cfg.BCRYPT_WORK_FACTOR).toBe(4);
  });

  test('NODE_ENV=test honors explicit BCRYPT_WORK_FACTOR override', () => {
    const cfg = loadConfig({ ...minimal(), NODE_ENV: 'test', BCRYPT_WORK_FACTOR: '6' });
    expect(cfg.BCRYPT_WORK_FACTOR).toBe(6);
  });

  test('returns frozen object', () => {
    const cfg = loadConfig(minimal());
    expect(Object.isFrozen(cfg)).toBe(true);
  });

  test('coerces numeric env vars', () => {
    const cfg = loadConfig({ ...minimal(), PORT: '4000', BCRYPT_WORK_FACTOR: '14' });
    expect(cfg.PORT).toBe(4000);
    expect(cfg.BCRYPT_WORK_FACTOR).toBe(14);
  });

  test('parses CSV CORS_ORIGINS', () => {
    const cfg = loadConfig({
      ...minimal(),
      CORS_ORIGINS: 'http://a.test, http://b.test ,http://c.test',
    });
    expect(cfg.CORS_ORIGINS).toEqual(['http://a.test', 'http://b.test', 'http://c.test']);
  });

  test('throws ConfigError when required JWT_SECRET missing', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
  });

  test('throws ConfigError on non-numeric PORT', () => {
    let err;
    try {
      loadConfig({ ...minimal(), PORT: 'not-a-number' });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ConfigError);
    expect(err.message).toMatch(/PORT/);
  });

  test('throws ConfigError on non-integer PORT', () => {
    expect(() => loadConfig({ ...minimal(), PORT: '3.14' })).toThrow(ConfigError);
  });

  test('throws ConfigError on negative number', () => {
    expect(() => loadConfig({ ...minimal(), BCRYPT_WORK_FACTOR: '-1' })).toThrow(ConfigError);
  });

  test('throws ConfigError on bad LOG_LEVEL enum', () => {
    expect(() => loadConfig({ ...minimal(), LOG_LEVEL: 'verbose' })).toThrow(ConfigError);
  });

  test('aggregates multiple errors into a single ConfigError', () => {
    let err;
    try {
      loadConfig({ PORT: 'nope', LOG_LEVEL: 'verbose' });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ConfigError);
    expect(err.details.errors.length).toBeGreaterThanOrEqual(2);
  });

  test('treats empty string as missing', () => {
    expect(() => loadConfig({ ...minimal(), JWT_SECRET: '' })).toThrow(ConfigError);
  });
});
