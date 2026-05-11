/**
 * pii-scrubber.js — regex-based redaction applied to prompts before they
 * leave the network.
 *
 * Limits — read this before relying on it:
 *   - Detects common shapes for emails, North-American + E.164 phone
 *     numbers, and 13-19 digit card numbers passing Luhn.
 *   - Does NOT detect names, addresses, government IDs, free-form
 *     birthdates, or many international phone formats.
 *   - It's a defence-in-depth layer, not a compliance boundary. For
 *     PII-heavy workloads, use a managed redactor (e.g. AWS Comprehend
 *     PII, Google DLP) and treat this as a fallback.
 *
 * The scrubber is pure (no I/O) so we can unit-test it exhaustively.
 */

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

// E.164-ish or NA-formatted phones; 10-15 digits with optional separators.
// We require the run to end on a digit so we don't eat a trailing space.
const PHONE_RE = /(?<!\d)\+?\d(?:[\s.-]?\d){9,14}(?!\d)/g;

// Candidate digit run for credit-card detection: 13-19 digits with
// optional separators. Final acceptance is gated on Luhn so we don't
// nuke arbitrary long numbers. Like phones, must end on a digit.
const CARD_CANDIDATE_RE = /(?<!\d)\d(?:[ -]?\d){12,18}(?!\d)/g;

export const PLACEHOLDERS = Object.freeze({
  EMAIL: '[REDACTED_EMAIL]',
  PHONE: '[REDACTED_PHONE]',
  CARD: '[REDACTED_CARD]',
});

function luhnPasses(digitsOnly) {
  let sum = 0;
  let even = false;
  for (let i = digitsOnly.length - 1; i >= 0; i -= 1) {
    let d = digitsOnly.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (even) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    even = !even;
  }
  return sum % 10 === 0 && digitsOnly.length >= 13 && digitsOnly.length <= 19;
}

/**
 * Scrub a string. Returns the scrubbed text.
 *
 * @param {string} text
 * @returns {string}
 */
export function scrubText(text) {
  if (typeof text !== 'string' || text.length === 0) return text;
  let out = text;
  out = out.replace(EMAIL_RE, PLACEHOLDERS.EMAIL);
  out = out.replace(CARD_CANDIDATE_RE, (m) => {
    const digits = m.replace(/[^0-9]/g, '');
    return luhnPasses(digits) ? PLACEHOLDERS.CARD : m;
  });
  out = out.replace(PHONE_RE, (m) => {
    const digits = m.replace(/[^0-9]/g, '');
    // Avoid double-redacting card numbers caught by phone regex.
    if (digits.length > 11 && luhnPasses(digits)) return m;
    return PLACEHOLDERS.PHONE;
  });
  return out;
}

/**
 * Scrub a value of arbitrary shape — strings are redacted, objects and
 * arrays are walked recursively, other primitives pass through.
 *
 * @param {unknown} value
 * @returns {unknown}
 */
export function scrub(value) {
  if (typeof value === 'string') return scrubText(value);
  if (Array.isArray(value)) return value.map((v) => scrub(v));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = scrub(v);
    return out;
  }
  return value;
}
