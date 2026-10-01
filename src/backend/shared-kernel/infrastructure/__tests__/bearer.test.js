/**
 * bearer.test.js — linear-time Authorization parsing (CodeQL
 * js/polynomial-redos regression).
 */
import { parseBearer } from '../bearer.js';

describe('parseBearer', () => {
  test.each([
    ['Bearer abc.def.ghi', 'abc.def.ghi'],
    ['bearer   tok', 'tok'],
    ['Bearer\ttok  ', 'tok'],
    ['BEARER glop_live_123', 'glop_live_123'],
  ])('%p → %p', (h, want) => {
    expect(parseBearer(h)).toBe(want);
  });

  test.each([
    [undefined], [null], [''], ['Basic abc'], ['Bearer'], ['Bearer '], ['Bearer a b'], ['Bearertok'],
    [`Bearer ${'x'.repeat(9000)}`],
  ])('rejects %p', (h) => {
    expect(parseBearer(h)).toBeNull();
  });

  test('adversarial whitespace input is linear', () => {
    const evil = `bearer ${' '.repeat(8000)}x y`;
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < 50; i++) parseBearer(evil);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    expect(ms).toBeLessThan(200);
  });
});
