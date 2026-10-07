// @ts-check
/**
 * Webhook URL validation (SSRF guard).
 *
 * The server POSTs event payloads to whatever URL a user registers. Without
 * a check, any signed-in user could point it at the cloud metadata service
 * (169.254.169.254), the database, Redis or any other internal host, and
 * have the platform make requests on their behalf from inside the network.
 *
 * Refused: non-http(s) schemes, embedded credentials, plain http, and hosts
 * that are (or obviously resolve to) loopback / private / link-local /
 * unique-local / CGNAT / unspecified addresses, `localhost`, and
 * single-label or `.internal` / `.local` names.
 *
 * `allowInsecure` (non-production only) permits http and private targets so
 * local development and tests can deliver to localhost.
 *
 * Not covered here (documented in the runbook): a public name that later
 * resolves to a private address (DNS rebinding) — egress should also be
 * restricted at the network layer.
 */
import net from 'node:net';

const BLOCKED_SUFFIXES = ['.internal', '.local', '.localhost', '.lan', '.home', '.corp'];

/** @param {string} ip */
function isPrivateV4(ip) {
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) ||           // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224                              // multicast + reserved
  );
}

/** @param {string} ip  IPv6 without brackets */
function isPrivateV6(ip) {
  const v = ip.toLowerCase();
  if (v === '::' || v === '::1') return true;
  const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateV4(mapped[1]);
  return /^(fc|fd)/.test(v) || /^fe[89ab]/.test(v) || v.startsWith('ff') || v.startsWith('::ffff:');
}

/**
 * @param {unknown} raw
 * @param {{ allowInsecure?: boolean }} [opts]
 * @returns {string|null} a human-readable problem, or null when the URL is acceptable
 */
export function webhookUrlProblem(raw, { allowInsecure = false } = {}) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2048) return 'url must be a string of at most 2048 characters';
  let url;
  try {
    url = new URL(raw);
  } catch {
    return 'url is not a valid URL';
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'url must use https';
  if (url.username || url.password) return 'url must not contain credentials';
  if (allowInsecure) return null;

  if (url.protocol !== 'https:') return 'url must use https';
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const kind = net.isIP(host);
  if (kind === 4 && isPrivateV4(host)) return 'url must not target a private or loopback address';
  if (kind === 6 && isPrivateV6(host)) return 'url must not target a private or loopback address';
  if (kind === 0) {
    // Decimal / hex / octal host forms ("2130706433", "0x7f.1") are parsed to
    // dotted IPv4 by WHATWG URL, so they were caught above; names remain.
    if (host === 'localhost' || !host.includes('.') || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
      return 'url must be a public host name';
    }
  }
  return null;
}
