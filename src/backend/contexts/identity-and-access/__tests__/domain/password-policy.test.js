/**
 * PasswordPolicy (NIST SP 800-63B rev. 4) + offline blocklist + bcrypt input
 * (roadmap 23 / P2).
 */
import bcrypt from 'bcrypt';
import {
  PasswordPolicy, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH_DEFAULT, PASSWORD_MIN_LENGTH_FLOOR,
} from '../../domain/user/password-policy.js';
import { isCommonPassword, commonPasswordSet } from '../../infrastructure/password-blocklist/common-passwords.js';
import { BcryptPasswordHasher, bcryptInput, BCRYPT_MAX_BYTES } from '../../infrastructure/crypto/bcrypt-password-hasher.js';
import { PasswordHash } from '../../domain/user/password-hash.js';
import { ValidationError } from '../../../../shared-kernel/domain/errors.js';

const policy = new PasswordPolicy({ isCommon: isCommonPassword });
const reason = (pw, ctx) => {
  try { policy.assertAcceptable(pw, ctx); return null; } catch (e) { return e.details?.reason ?? e.message; }
};

describe('PasswordPolicy', () => {
  test('defaults: 15 minimum (single-factor), 128 maximum, floor 8', () => {
    expect(PASSWORD_MIN_LENGTH_DEFAULT).toBe(15);
    expect(PASSWORD_MAX_LENGTH).toBe(128);
    expect(PASSWORD_MIN_LENGTH_FLOOR).toBe(8);
    expect(() => new PasswordPolicy({ minLength: 7 })).toThrow(/minimum length/);
    expect(() => new PasswordPolicy({ minLength: 129 })).toThrow(/minimum length/);
    expect(() => new PasswordPolicy({ minLength: 10.5 })).toThrow(/minimum length/);
  });

  test.each([
    ['correct horse battery staple', null],          // passphrase with spaces: fine
    ['all lowercase no digits at all', null],         // no composition rules
    ['ünïcödé pässphrâse ✓ 2026', null],              // any printable Unicode
    ['🦊🦊 fox and friends go hiking', null],
    ['x'.repeat(14) + 'y', null],                     // exactly 15, not purely repetitive
    ['a'.repeat(PASSWORD_MAX_LENGTH - 1) + 'b', null], // 128 allowed
  ])('accepts %p', (pw, want) => expect(reason(pw)).toBe(want));

  test.each([
    [undefined, 'missing'],
    [123456789012345, 'missing'],
    ['short-pass', 'too_short'],
    ['a'.repeat(PASSWORD_MAX_LENGTH) + 'b', 'too_long'],
    ['fifteen chars\u0000!!', 'control_characters'],
    ['tab\tseparated pass', 'control_characters'],
    ['aaaaaaaaaaaaaaaa', 'repetitive'],
    ['abcabcabcabcabcabc', 'repetitive'],
    ['1212121212121212', 'repetitive'],
    ['abcdefghijklmnop', 'repetitive'],
    ['zyxwvutsrqponmlk', 'repetitive'],
    ['123456789012345', 'repetitive'],   // digits wrap 9 → 0
    ['987654321098765', 'repetitive'],
    ['qwertyuiopasdfgh', 'common'],
    ['passwordpassword', 'common'],
    ['1qaz2wsx3edc4rfv', 'common'],
  ])('rejects %p (%s)', (pw, want) => expect(reason(pw)).toBe(want));

  test('length counts code points after NFKC, not UTF-16 units', () => {
    // 15 emoji = 30 UTF-16 units but 15 characters → acceptable.
    expect(reason('🦊🐼🐨🦁🐯🐸🐵🐔🐧🐦🐤🦆🦅🦉🦇')).toBeNull();
    // 14 emoji → too short even though .length is 28.
    expect(reason('🦊🐼🐨🦁🐯🐸🐵🐔🐧🐦🐤🦆🦅🦉')).toBe('too_short');
    // Fullwidth forms normalise to ASCII before the blocklist check.
    expect(reason('ｐａｓｓｗｏｒｄｐａｓｓｗｏｒｄ')).toBe('common');
  });

  test('context-specific words: username, email (local part and whole), service name', () => {
    const ctx = { username: 'marcus_patman', email: 'marcus.patman@example.com' };
    expect(reason('marcus_patman', ctx)).toBe('too_short');
    expect(reason('marcus_patman2026!!', ctx)).toBe('contains_context');
    expect(reason('Marcus.Patman 1234', ctx)).toBe('contains_context');
    expect(reason('marcus.patman@example.com', ctx)).toBe('contains_context');
    expect(reason('gui-lop-2026-2027', ctx)).toBe('contains_context');
    expect(reason('patman likes long walks', ctx)).toBeNull(); // containing a name is fine
  });

  test('error carries the field and a reason, never the password', () => {
    try {
      policy.assertAcceptable('PasswordPassword', { field: 'newPassword' });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect(e.details).toEqual({ field: 'newPassword', reason: 'common' });
      expect(e.message).not.toMatch(/PasswordPassword/);
    }
  });
});

describe('offline blocklist', () => {
  test('loaded once, lower-case, ≥8 characters, tens of thousands of entries', () => {
    const set = commonPasswordSet();
    expect(set.size).toBeGreaterThan(30_000);
    expect(commonPasswordSet()).toBe(set);
    for (const w of ['password', '12345678', 'iloveyou', 'qwertyuiop']) expect(isCommonPassword(w)).toBe(true);
    expect([...set].every((w) => w === w.toLowerCase() && [...w].length >= 8)).toBe(true);
    expect(isCommonPassword('correct horse battery staple')).toBe(false);
  });
});

describe('bcrypt input (72-byte window, NFKC)', () => {
  test('≤ 72 bytes: unchanged apart from NFKC (existing hashes keep verifying)', () => {
    expect(bcryptInput('plain-ascii-passphrase')).toBe('plain-ascii-passphrase');
    expect(bcryptInput('ｆｕｌｌｗｉｄｔｈ')).toBe('fullwidth');
  });

  test('> 72 bytes: SHA-256 pre-hash, so every byte matters', () => {
    const a = 'x'.repeat(80) + 'A';
    const b = 'x'.repeat(80) + 'B';
    expect(Buffer.byteLength(a)).toBeGreaterThan(BCRYPT_MAX_BYTES);
    expect(bcryptInput(a)).not.toBe(bcryptInput(b));
    expect(Buffer.byteLength(bcryptInput(a))).toBe(44);
  });

  const hasher = new BcryptPasswordHasher({ rounds: 4, useWorkerPool: false });

  test('long passphrases sharing a 72-byte prefix are now different passwords', async () => {
    const prefix = 'the quick brown fox jumps over the lazy dog and keeps on running far away ';
    const h = await hasher.hash(prefix + 'one');
    expect(await hasher.verify(prefix + 'one', h)).toBe(true);
    expect(await hasher.verify(prefix + 'two', h)).toBe(false); // was TRUE before (bcrypt truncation)
  });

  test('multi-byte passwords keep all their characters', async () => {
    const pw = 'пароль-'.repeat(10); // 70 chars, 130 bytes
    const h = await hasher.hash(pw);
    expect(await hasher.verify(pw, h)).toBe(true);
    expect(await hasher.verify(pw.slice(0, -1) + 'X', h)).toBe(false);
  });

  test('NFKC: the same password typed as fullwidth verifies', async () => {
    const h = await hasher.hash('ｓｅｃｒｅｔ passphrase');
    expect(await hasher.verify('secret passphrase', h)).toBe(true);
  });

  test('legacy hashes (raw bcrypt, pre-NFKC / truncated) still verify', async () => {
    const longPw = 'legacy '.repeat(15); // 105 bytes
    const legacyLong = PasswordHash.fromTrustedHash(await bcrypt.hash(longPw, 4));
    expect(await hasher.verify(longPw, legacyLong)).toBe(true);

    const legacyNf = PasswordHash.fromTrustedHash(await bcrypt.hash('ｌｅｇａｃｙ', 4));
    expect(await hasher.verify('ｌｅｇａｃｙ', legacyNf)).toBe(true);
  });
});
