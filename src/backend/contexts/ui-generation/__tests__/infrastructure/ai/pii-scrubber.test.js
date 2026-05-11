/**
 * pii-scrubber.test.js — exercise the regex-based PII redactor.
 */
import { scrub, scrubText, PLACEHOLDERS } from '../../../infrastructure/ai/pii-scrubber.js';

describe('scrubText', () => {
  test('redacts email addresses', () => {
    expect(scrubText('contact me at alice@example.com please'))
      .toBe(`contact me at ${PLACEHOLDERS.EMAIL} please`);
  });

  test('redacts multiple emails', () => {
    expect(scrubText('a@b.co and c@d.org'))
      .toBe(`${PLACEHOLDERS.EMAIL} and ${PLACEHOLDERS.EMAIL}`);
  });

  test('redacts phone numbers in common formats', () => {
    expect(scrubText('call +1-415-555-0123 now'))
      .toBe(`call ${PLACEHOLDERS.PHONE} now`);
    expect(scrubText('phone: 415 555 0123'))
      .toBe(`phone: ${PLACEHOLDERS.PHONE}`);
  });

  test('redacts a Luhn-valid card number', () => {
    // 4111 1111 1111 1111 is the classic Visa test card; passes Luhn.
    expect(scrubText('card 4111 1111 1111 1111 expires soon'))
      .toBe(`card ${PLACEHOLDERS.CARD} expires soon`);
  });

  test('does not redact arbitrary 16-digit non-Luhn numbers', () => {
    const text = 'serial 1234567890123456 is fine';
    // Non-Luhn — should not become a CARD placeholder.
    expect(scrubText(text)).not.toContain(PLACEHOLDERS.CARD);
  });

  test('leaves prose alone', () => {
    const text = 'The quick brown fox jumps over the lazy dog.';
    expect(scrubText(text)).toBe(text);
  });

  test('handles empty / non-string input', () => {
    expect(scrubText('')).toBe('');
    expect(scrubText(42)).toBe(42);
    expect(scrubText(null)).toBe(null);
  });
});

describe('scrub (recursive)', () => {
  test('walks objects and arrays', () => {
    const input = {
      user: 'alice@example.com',
      tags: ['+44 20 7946 0958', 'no pii here'],
      nested: { secret: 'card 4111 1111 1111 1111' },
      flag: true,
      n: 7,
    };
    const out = scrub(input);
    expect(out.user).toBe(PLACEHOLDERS.EMAIL);
    expect(out.tags[0]).toBe(PLACEHOLDERS.PHONE);
    expect(out.tags[1]).toBe('no pii here');
    expect(out.nested.secret).toBe(`card ${PLACEHOLDERS.CARD}`);
    expect(out.flag).toBe(true);
    expect(out.n).toBe(7);
  });

  test('returns primitives unchanged', () => {
    expect(scrub(42)).toBe(42);
    expect(scrub(true)).toBe(true);
    expect(scrub(null)).toBe(null);
  });
});
