// @ts-check
/**
 * Offline common-password blocklist (NIST SP 800-63B rev. 4: "passwords
 * obtained from previous breach corpuses" / "commonly-used values").
 *
 * Source: the 100,000 most common entries of SecLists'
 * 10-million-password-list (OWASP SecLists, Daniel Miessler & Jason Haddix,
 * CC BY-SA 3.0 — see README.md here), keeping only entries of 8+ characters
 * (shorter ones can never pass the length rule), lower-cased and
 * de-duplicated: ~38k entries, ~350 KB, loaded once into a Set (O(1)
 * lookup). No network calls — breach-API lookups (HIBP k-anonymity) can be
 * added later as an opt-in adapter behind the same `isCommon` function.
 */
import LIST from './common-passwords.data.js';

let cached = /** @type {Set<string>|null} */ (null);

/** @returns {Set<string>} */
export function commonPasswordSet() {
  if (!cached) {
    cached = new Set(LIST.split('\n'));
  }
  return cached;
}

/** @param {string} lowercased */
export function isCommonPassword(lowercased) {
  return commonPasswordSet().has(lowercased);
}
