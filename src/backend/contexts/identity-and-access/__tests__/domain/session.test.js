import { Session } from '../../domain/session/session.js';
import { RefreshTokenSecret } from '../../domain/session/refresh-token-secret.js';
import {
  SessionExpiredError,
  SessionRevokedError,
} from '../../domain/errors.js';
import { ValidationError } from '../../../../shared-kernel/domain/errors.js';
const TTL = 60_000;

const issue = ({ now = new Date('2026-01-01T00:00:00Z') } = {}) =>
  Session.issue({
    id: 's1',
    userId: 'u1',
    refreshTokenHash: 'h0',
    ip: '127.0.0.1',
    userAgent: 'jest',
    ttlMs: TTL,
    now,
  });

describe('RefreshTokenSecret', () => {
  test('generate returns 64-hex secret', () => {
    const s = RefreshTokenSecret.generate();
    expect(s.value).toMatch(/^[a-f0-9]{64}$/);
  });
  test('hash is deterministic 64-hex sha256', () => {
    const s = new RefreshTokenSecret('a'.repeat(64));
    const h = s.hash();
    expect(h).toHaveLength(64);
    expect(h).toBe(s.hash());
  });
  test('redacted in string conversions', () => {
    const s = new RefreshTokenSecret('b'.repeat(64));
    expect(String(s)).not.toContain('b'.repeat(64));
    expect(JSON.stringify(s)).not.toContain('b'.repeat(64));
  });
  test('rejects non-hex secrets', () => {
    expect(() => new RefreshTokenSecret('not-hex')).toThrow(ValidationError);
  });
});

describe('Session aggregate', () => {
  test('issue produces session.created event with TTL applied', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const s = issue({ now });
    expect(s.expiresAt.getTime() - now.getTime()).toBe(TTL);
    const events = s.pullEvents();
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('session.created');
  });

  test('refresh rotates hash and slides expiry', () => {
    const s = issue();
    s.pullEvents();
    const later = new Date(s.createdAt.getTime() + 30_000);
    s.refresh('h1', later, TTL);
    expect(s.refreshTokenHash).toBe('h1');
    expect(s.expiresAt.getTime()).toBe(later.getTime() + TTL);
    expect(s.pullEvents().map((e) => e.eventType)).toEqual([
      'session.refreshed',
    ]);
  });

  test('cannot refresh after expiry', () => {
    const s = issue();
    s.pullEvents();
    const later = new Date(s.expiresAt.getTime() + 1);
    expect(() => s.refresh('h1', later, TTL)).toThrow(SessionExpiredError);
  });

  test('revocation is irreversible and idempotent', () => {
    const s = issue();
    s.pullEvents();
    s.revoke(new Date());
    expect(s.isActive).toBe(false);
    s.revoke(new Date()); // idempotent
    expect(s.pullEvents().map((e) => e.eventType)).toEqual([
      'session.revoked',
    ]);
    const later = new Date(s.createdAt.getTime() + 1000);
    expect(() => s.refresh('h2', later, TTL)).toThrow(SessionRevokedError);
    expect(() => s.markSeen(later)).toThrow(SessionRevokedError);
  });

  test('isUsable false once expired', () => {
    const s = issue();
    expect(s.isUsable(s.createdAt)).toBe(true);
    expect(s.isUsable(new Date(s.expiresAt.getTime() + 1))).toBe(false);
  });
});
