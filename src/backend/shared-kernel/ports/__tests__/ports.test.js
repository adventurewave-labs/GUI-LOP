import { CLOCK_PORT } from '../clock.js';
import { ID_GENERATOR_PORT } from '../id-generator.js';
import { OUTBOX_PORT } from '../outbox.js';
import { UNIT_OF_WORK_PORT, runInTransaction } from '../unit-of-work.js';

describe('Port symbols', () => {
  test('all port symbols are unique and stable', () => {
    const symbols = new Set([CLOCK_PORT, ID_GENERATOR_PORT, OUTBOX_PORT, UNIT_OF_WORK_PORT]);
    expect(symbols.size).toBe(4);
    expect(typeof CLOCK_PORT).toBe('symbol');
  });
});

describe('runInTransaction helper', () => {
  test('delegates to uow.run', async () => {
    const uow = { run: jest.fn(async (fn) => fn({ client: 'c' })) };
    const result = await runInTransaction(uow, async (ctx) => `ran-with-${ctx.client}`);
    expect(uow.run).toHaveBeenCalledTimes(1);
    expect(result).toBe('ran-with-c');
  });

  test('rejects bad uow', () => {
    expect(() => runInTransaction(null, () => {})).toThrow(TypeError);
    expect(() => runInTransaction({}, () => {})).toThrow(TypeError);
  });
});
