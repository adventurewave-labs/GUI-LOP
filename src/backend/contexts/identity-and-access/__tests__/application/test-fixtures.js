import { InMemoryUserRepository } from '../../infrastructure/persistence/inmemory-user-repository.js';
import { InMemorySessionRepository } from '../../infrastructure/persistence/inmemory-session-repository.js';
import { InMemoryGrantsRepository } from '../../infrastructure/persistence/inmemory-grants-repository.js';
import { InMemoryApiKeyRepository } from '../../infrastructure/persistence/inmemory-api-key-repository.js';
import { InMemoryOutbox } from '../../application/ports/outbox.js';
import { InMemoryTokenBlacklist } from '../../infrastructure/cache/inmemory-token-blacklist.js';
import { FakePasswordHasher } from '../../infrastructure/crypto/fake-password-hasher.js';
import { JwtTokenIssuer } from '../../infrastructure/tokens/jwt-token-issuer.js';

let counter = 0;
export function makeIdGen() {
  counter = 0;
  return {
    newId: () => `id-${++counter}`,
    randomBytes: (n) => Buffer.from(Array.from({ length: n }, (_, i) => (counter * 31 + i) & 0xff)),
  };
}

export function makeFixedClock(start = new Date('2026-05-10T00:00:00Z')) {
  let t = new Date(start);
  return {
    now: () => new Date(t),
    advance: (ms) => { t = new Date(t.getTime() + ms); },
    set: (d) => { t = new Date(d); },
  };
}

export function makeFixtures(overrides = {}) {
  return {
    userRepository: new InMemoryUserRepository(),
    sessionRepository: new InMemorySessionRepository(),
    grantsRepository: new InMemoryGrantsRepository(),
    apiKeyRepository: new InMemoryApiKeyRepository(),
    outbox: new InMemoryOutbox(),
    passwordHasher: new FakePasswordHasher(),
    tokenIssuer: new JwtTokenIssuer({ secret: 'test-secret' }),
    tokenBlacklist: new InMemoryTokenBlacklist(),
    idGenerator: makeIdGen(),
    clock: makeFixedClock(),
    ...overrides,
  };
}

/**
 * Deterministic UUID-shaped id generator for tests that exercise the
 * ApiKey aggregate (which validates ids are real UUIDs). The hex layout
 * is fixed so repeated test runs produce the same identifiers.
 */
let uuidCounter = 0;
export function makeUuidIdGen() {
  uuidCounter = 0;
  return {
    newId: () => {
      uuidCounter += 1;
      const hex = uuidCounter.toString(16).padStart(12, '0');
      return `00000000-0000-4000-8000-${hex}`;
    },
    randomBytes: (n) =>
      Buffer.from(
        Array.from({ length: n }, (_, i) => (uuidCounter * 31 + i) & 0xff),
      ),
  };
}
