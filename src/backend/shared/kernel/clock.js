/**
 * Clock — abstract source of time for deterministic tests.
 */

export class SystemClock {
  now() {
    return new Date();
  }

  nowIso() {
    return this.now().toISOString();
  }
}

export class FrozenClock {
  constructor(initial = new Date('2026-01-01T00:00:00.000Z')) {
    this._now = new Date(initial);
  }

  now() {
    return new Date(this._now);
  }

  nowIso() {
    return this.now().toISOString();
  }

  advance(ms) {
    this._now = new Date(this._now.getTime() + ms);
    return this.now();
  }

  set(date) {
    this._now = new Date(date);
  }
}
