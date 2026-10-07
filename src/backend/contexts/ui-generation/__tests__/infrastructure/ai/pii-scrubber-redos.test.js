/**
 * pii-scrubber-redos.test.js — email detection stays linear-ish on
 * adversarial input and still matches real addresses.
 */
import { scrubText, PLACEHOLDERS } from '../../../infrastructure/ai/pii-scrubber.js';

describe('pii-scrubber email regex', () => {
  test('still redacts common address shapes', () => {
    for (const addr of ['a@b.co', 'first.last+tag@mail.example.co.uk', 'X_Y%z@sub-domain.io']) {
      expect(scrubText(`contact ${addr} now`)).toBe(`contact ${PLACEHOLDERS.EMAIL} now`);
    }
  });

  test('pathological input completes quickly', () => {
    const evil = `a@${'a.'.repeat(20000)}`;
    const t0 = Date.now();
    scrubText(evil);
    expect(Date.now() - t0).toBeLessThan(500);
  });
});
