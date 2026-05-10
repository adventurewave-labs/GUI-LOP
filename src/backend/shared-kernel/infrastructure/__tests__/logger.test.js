import { createLogger } from '../logger.js';

describe('createLogger', () => {
  let stdoutSpy;
  let stderrSpy;

  beforeEach(() => {
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  test('emits info on stdout as JSON', () => {
    const log = createLogger({ level: 'info' });
    log.info('hello', { ctx: 1 });
    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const line = stdoutSpy.mock.calls[0][0];
    const parsed = JSON.parse(line.trim());
    expect(parsed.level).toBe('info');
    expect(parsed.msg).toBe('hello');
    expect(parsed.ctx).toBe(1);
    expect(parsed.ts).toMatch(/T/);
  });

  test('error goes to stderr', () => {
    const log = createLogger({ level: 'info' });
    log.error('boom');
    expect(stderrSpy).toHaveBeenCalledTimes(1);
  });

  test('respects level threshold', () => {
    const log = createLogger({ level: 'warn' });
    log.debug('skip me');
    log.info('skip me too');
    expect(stdoutSpy).not.toHaveBeenCalled();
    log.warn('keep me');
    expect(stderrSpy).toHaveBeenCalledTimes(1);
  });

  test('child logger inherits base fields', () => {
    const log = createLogger({ level: 'info', base: { service: 'svc' } });
    const child = log.child({ ctx: 'a' });
    child.info('m');
    const parsed = JSON.parse(stdoutSpy.mock.calls[0][0].trim());
    expect(parsed.service).toBe('svc');
    expect(parsed.ctx).toBe('a');
  });
});
