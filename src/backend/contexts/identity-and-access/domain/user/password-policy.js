// @ts-check
/**
 * PasswordPolicy — NIST SP 800-63B rev. 4 §3.1.1.2 (roadmap 23 / P2).
 *
 *   - length in Unicode code points after NFKC normalisation;
 *     minimum 15 when the password is the only factor (this app has no MFA),
 *     configurable down to 8 once a second factor exists; maximum 128
 *     (NIST: permit at least 64);
 *   - NO composition rules (no "one upper, one digit, one symbol") and no
 *     periodic rotation — they push users to predictable patterns;
 *   - all printable characters, including spaces and emoji, are allowed;
 *     control characters are not (NUL silently truncates in bcrypt's C core);
 *   - reject values on a blocklist: commonly used/breached passwords
 *     (offline list, injected), context-specific words (the user's email
 *     local part / username, the service name), and repetitive or
 *     sequential strings.
 *
 * Errors are ValidationError on the given field with a machine-readable
 * `reason` in details, so the SPA can say *why* without echoing the value.
 */
import { ValidationError } from '../../../../shared-kernel/domain/errors.js';

export const PASSWORD_MIN_LENGTH_DEFAULT = 15;
export const PASSWORD_MIN_LENGTH_FLOOR = 8;
export const PASSWORD_MAX_LENGTH = 128;

const SERVICE_WORDS = ['guilop', 'gui-lop', 'gui lop'];
// eslint-disable-next-line no-control-regex -- the point is to find control characters
const CONTROL = /[\u0000-\u001f\u007f]/;

/** @param {string} s */
const codePoints = (s) => [...s].length;

/**
 * True for strings made only of one repeated unit ("aaaa…", "abcabc…",
 * "12121212…") or a straight run up/down the code-point line ("abcdefgh…",
 * "987654321…").
 * @param {string} s
 */
function isRepetitiveOrSequential(s) {
  const cps = [...s.toLowerCase()].map((c) => /** @type {number} */ (c.codePointAt(0)));
  for (let unit = 1; unit <= 4 && unit < cps.length; unit++) {
    if (cps.every((c, i) => c === cps[i % unit])) return true;
  }
  // Runs up/down the alphabet or keypad ("abcdef…", "9876…"); digits wrap
  // ("…7890123…") because that is how people type them.
  const isDigit = (/** @type {number} */ c) => c >= 48 && c <= 57;
  const delta = (/** @type {number} */ a, /** @type {number} */ b) => (isDigit(a) && isDigit(b) ? ((b - a + 10) % 10) : b - a);
  const step = delta(cps[0], cps[1]);
  const norm = (/** @type {number} */ d) => (d === 9 ? -1 : d); // digit wrap-down
  const s0 = norm(step);
  if (Math.abs(s0) === 1 && cps.every((c, i) => i === 0 || norm(delta(cps[i - 1], c)) === s0)) return true;
  return false;
}

export class PasswordPolicy {
  /**
   * @param {{ minLength?: number, isCommon?: (lowercased: string) => boolean }} [opts]
   */
  constructor({ minLength = PASSWORD_MIN_LENGTH_DEFAULT, isCommon = () => false } = {}) {
    if (!Number.isInteger(minLength) || minLength < PASSWORD_MIN_LENGTH_FLOOR || minLength > PASSWORD_MAX_LENGTH) {
      throw new ValidationError(`password minimum length must be an integer in [${PASSWORD_MIN_LENGTH_FLOOR}, ${PASSWORD_MAX_LENGTH}]`, 'minLength');
    }
    this.minLength = minLength;
    this._isCommon = isCommon;
  }

  /** Canonical form that gets hashed: NFKC (so "ｐａｓｓ" and "pass" are one password). */
  static normalise(/** @type {string} */ pw) {
    return pw.normalize('NFKC');
  }

  /**
   * Throws ValidationError(field, { reason }) if `password` is unacceptable.
   * @param {unknown} password
   * @param {{ field?: string, email?: string|null, username?: string|null }} [ctx]
   */
  assertAcceptable(password, { field = 'password', email = null, username = null } = {}) {
    const fail = (/** @type {string} */ reason, /** @type {string} */ message) => {
      throw new ValidationError(message, { field, reason });
    };
    if (typeof password !== 'string') fail('missing', `${field} is required`);
    const pw = PasswordPolicy.normalise(/** @type {string} */ (password));
    const len = codePoints(pw);
    if (len < this.minLength) fail('too_short', `${field} must be at least ${this.minLength} characters`);
    if (len > PASSWORD_MAX_LENGTH) fail('too_long', `${field} must be at most ${PASSWORD_MAX_LENGTH} characters`);
    if (CONTROL.test(pw)) fail('control_characters', `${field} must not contain control characters`);

    const lower = pw.toLowerCase();
    if (this._isCommon(lower)) fail('common', `${field} is too common; choose a different password`);
    if (isRepetitiveOrSequential(pw)) fail('repetitive', `${field} is a repeated or sequential pattern; choose a different password`);

    const context = [
      ...SERVICE_WORDS,
      username,
      typeof email === 'string' ? email.split('@')[0] : null,
      email,
    ]
      .filter((w) => typeof w === 'string' && w.length >= 4)
      .map((w) => /** @type {string} */ (w).toLowerCase());
    // The password IS the context word, or is that word plus trivial padding
    // (digits/punctuation/whitespace) — "marcus2024!!" for user "marcus".
    const stripped = lower.replace(/[\d\s\p{P}\p{S}]+/gu, '');
    if (context.some((w) => lower === w || stripped === w.replace(/[\d\s\p{P}\p{S}]+/gu, ''))) {
      fail('contains_context', `${field} must not be based on your username, email or the service name`);
    }
  }
}
