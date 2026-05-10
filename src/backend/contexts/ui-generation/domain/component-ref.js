import { ValidationError } from '../../../shared/kernel/errors.js';

export class ComponentRef {
  constructor({ name, version }) {
    if (!name) throw new ValidationError('ComponentRef.name is required');
    if (!version) throw new ValidationError('ComponentRef.version is required');
    if (!/^\d+\.\d+\.\d+$/.test(version)) {
      throw new ValidationError(`ComponentRef.version must be semver: ${version}`);
    }
    this.name = name;
    this.version = version;
    Object.freeze(this);
  }

  static of(spec) {
    if (typeof spec === 'string') {
      const [name, version] = spec.split('@');
      return new ComponentRef({ name, version });
    }
    return new ComponentRef(spec);
  }

  toJSON() {
    return { name: this.name, version: this.version };
  }

  toString() {
    return `${this.name}@${this.version}`;
  }
}
