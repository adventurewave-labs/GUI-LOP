/**
 * Clock port — abstracts wall-clock reads. Domain code stays pure; tests
 * use a frozen clock for determinism.
 */
export class Clock {
  /** @returns {Date} */
  now() { return new Date(); }
}

export class FixedClock extends Clock {
  constructor(date) {
    super();
    this._date = date instanceof Date ? date : new Date(date);
  }
  now() { return new Date(this._date.getTime()); }
  set(date) { this._date = date instanceof Date ? date : new Date(date); }
  advance(ms) { this._date = new Date(this._date.getTime() + ms); }
}
