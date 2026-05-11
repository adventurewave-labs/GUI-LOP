import { ApiKey } from '../../domain/api-key/api-key.js';
import { ApiKeyId } from '../../domain/api-key/api-key-id.js';
import { ApiKeySecret } from '../../domain/api-key/api-key-secret.js';
import { Permission } from '../../domain/permission/permission.js';
import {
  ConflictError,
  ValidationError,
} from '../../../../shared-kernel/domain/errors.js';

const validUuid = '11111111-1111-4111-8111-111111111111';

function makeIdGen(seed = 1) {
  let counter = seed;
  return {
    newId: () => {
      counter += 1;
      const hex = counter.toString(16).padStart(12, '0');
      return `00000000-0000-4000-8000-${hex}`;
    },
    randomBytes: (n) =>
      Buffer.from(Array.from({ length: n }, (_, i) => (counter * 31 + i) & 0xff)),
  };
}

function makeClock(start = new Date('2026-05-10T00:00:00Z')) {
  let t = new Date(start);
  return {
    now: () => new Date(t),
    advance: (ms) => { t = new Date(t.getTime() + ms); },
  };
}

describe('ApiKeyId', () => {
  test('rejects non-UUID strings', () => {
    expect(() => ApiKeyId.of('not-a-uuid')).toThrow(ValidationError);
  });
  test('accepts a valid UUID and lower-cases it', () => {
    const id = ApiKeyId.of(validUuid.toUpperCase());
    expect(id.value).toBe(validUuid);
  });
  test('cannot be constructed without the brand symbol', () => {
    expect(() => new ApiKeyId(Symbol('x'), validUuid)).toThrow(ValidationError);
  });
  test('generate uses idGen.newId()', () => {
    const id = ApiKeyId.generate(makeIdGen());
    expect(typeof id.value).toBe('string');
    expect(id.value).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });
  test('equals compares by value', () => {
    expect(ApiKeyId.of(validUuid).equals(ApiKeyId.of(validUuid))).toBe(true);
  });
});

describe('ApiKeySecret', () => {
  test('generate produces a glop_ prefixed token', () => {
    const s = ApiKeySecret.generate(makeIdGen());
    expect(s.value.startsWith('glop_')).toBe(true);
    expect(s.value.length).toBeGreaterThanOrEqual('glop_'.length + 43);
  });
  test('hash is sha256 hex (64 chars)', () => {
    const s = ApiKeySecret.generate(makeIdGen());
    const h = s.hash();
    expect(h).toMatch(/^[a-f0-9]{64}$/);
    // Same input -> same hash.
    expect(new ApiKeySecret(s.value).hash()).toBe(h);
  });
  test('rejects raw values without the glop_ prefix', () => {
    expect(() => new ApiKeySecret('Bearer xxx')).toThrow(ValidationError);
  });
  test('rejects values with bad tail length', () => {
    expect(() => new ApiKeySecret('glop_short')).toThrow(ValidationError);
  });
  test('toString and toJSON redact the secret', () => {
    const s = ApiKeySecret.generate(makeIdGen());
    expect(String(s)).not.toContain(s.value);
    expect(JSON.stringify(s)).not.toContain(s.value);
  });
  test('looksLikeApiKey is a cheap prefix check', () => {
    expect(ApiKeySecret.looksLikeApiKey('glop_anything')).toBe(true);
    expect(ApiKeySecret.looksLikeApiKey('jwt-like')).toBe(false);
    expect(ApiKeySecret.looksLikeApiKey(undefined)).toBe(false);
  });
});

describe('ApiKey aggregate', () => {
  const user = { id: 'user-abc', isActive: true };

  test('mint returns aggregate + plaintext, emits api_key.minted', () => {
    const idGen = makeIdGen();
    const clock = makeClock();
    const { aggregate, plaintextKey } = ApiKey.mint({
      user,
      name: 'CI',
      permissions: ['workflow:read'],
      idGen,
      clock,
    });
    expect(aggregate).toBeInstanceOf(ApiKey);
    expect(plaintextKey.startsWith('glop_')).toBe(true);
    // hash is stored — plaintext is not.
    expect(aggregate.keyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(aggregate.keyHash).not.toBe(plaintextKey);
    const events = aggregate.pullEvents();
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('api_key.minted');
    expect(events[0].payload.userId).toBe('user-abc');
    expect(events[0].payload.permissions).toEqual(['workflow:read']);
  });

  test('mint refuses deactivated users', () => {
    expect(() =>
      ApiKey.mint({
        user: { id: 'u', isActive: false },
        name: 'x',
        idGen: makeIdGen(),
        clock: makeClock(),
      }),
    ).toThrow(ConflictError);
  });

  test('mint refuses past expiry', () => {
    expect(() =>
      ApiKey.mint({
        user,
        name: 'x',
        expiresAt: new Date('2020-01-01T00:00:00Z'),
        idGen: makeIdGen(),
        clock: makeClock(),
      }),
    ).toThrow(ValidationError);
  });

  test('mint rejects empty/oversized name', () => {
    expect(() =>
      ApiKey.mint({ user, name: '', idGen: makeIdGen(), clock: makeClock() }),
    ).toThrow(ValidationError);
    expect(() =>
      ApiKey.mint({
        user,
        name: 'x'.repeat(300),
        idGen: makeIdGen(),
        clock: makeClock(),
      }),
    ).toThrow(ValidationError);
  });

  test('revoke is irreversible and idempotent', () => {
    const clock = makeClock();
    const { aggregate } = ApiKey.mint({ user, name: 'x', idGen: makeIdGen(), clock });
    aggregate.pullEvents();
    aggregate.revoke(clock.now());
    expect(aggregate.isActive).toBe(false);
    const ev1 = aggregate.pullEvents();
    expect(ev1.map((e) => e.eventType)).toEqual(['api_key.revoked']);
    // Idempotent — second call is a no-op.
    aggregate.revoke(clock.now());
    expect(aggregate.pullEvents()).toHaveLength(0);
  });

  test('isUsable is false after revoke', () => {
    const clock = makeClock();
    const { aggregate } = ApiKey.mint({ user, name: 'x', idGen: makeIdGen(), clock });
    expect(aggregate.isUsable(clock.now())).toBe(true);
    aggregate.revoke(clock.now());
    expect(aggregate.isUsable(clock.now())).toBe(false);
  });

  test('expired keys are silently unusable', () => {
    const clock = makeClock();
    const { aggregate } = ApiKey.mint({
      user,
      name: 'x',
      expiresAt: new Date(clock.now().getTime() + 1000),
      idGen: makeIdGen(),
      clock,
    });
    expect(aggregate.isUsable(clock.now())).toBe(true);
    clock.advance(60_000);
    expect(aggregate.isUsable(clock.now())).toBe(false);
  });

  test('recordUsage updates lastUsedAt and emits api_key.used', () => {
    const clock = makeClock();
    const { aggregate } = ApiKey.mint({ user, name: 'x', idGen: makeIdGen(), clock });
    aggregate.pullEvents();
    clock.advance(5000);
    aggregate.recordUsage(clock.now());
    expect(aggregate.lastUsedAt).toEqual(clock.now());
    expect(aggregate.pullEvents().map((e) => e.eventType)).toEqual([
      'api_key.used',
    ]);
  });

  test('recordUsage throws on revoked key', () => {
    const clock = makeClock();
    const { aggregate } = ApiKey.mint({ user, name: 'x', idGen: makeIdGen(), clock });
    aggregate.revoke(clock.now());
    expect(() => aggregate.recordUsage(clock.now())).toThrow(ConflictError);
  });

  test('permissions can be Permission VOs or strings', () => {
    const { aggregate } = ApiKey.mint({
      user,
      name: 'x',
      permissions: [new Permission('workflow:read'), 'workflow:execute'],
      idGen: makeIdGen(),
      clock: makeClock(),
    });
    expect(aggregate.permissions.map((p) => p.value)).toEqual([
      'workflow:read',
      'workflow:execute',
    ]);
  });
});
