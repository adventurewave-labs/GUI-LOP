export class ListDeadLettersQuery {
  constructor({ deadLetterRepository }) {
    this._repo = deadLetterRepository;
  }

  async execute({ limit = 100, offset = 0 } = {}) {
    return this._repo.list({ limit, offset });
  }
}
