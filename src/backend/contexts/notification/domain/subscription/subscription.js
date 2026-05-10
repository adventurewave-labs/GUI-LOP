/**
 * Subscription aggregate root.
 *
 * Invariants:
 *   - id, subscriberKind, subscriberRef, channel, address are required.
 *   - subscriberKind is one of {user, webhook}.
 *   - active subscriptions can record activity; deactivated cannot.
 *   - filter must be a Filter VO.
 *   - address.channel must equal the subscription's channel.
 */

import { randomUUID } from 'crypto';
import { ValidationError } from '../../../../shared-kernel/domain/errors.js';
import { Channel } from './channel.js';
import { Filter } from './filter.js';
import { EndpointAddress } from './endpoint-address.js';

const SUBSCRIBER_KINDS = new Set(['user', 'webhook']);

export class Subscription {
  constructor({
    id,
    subscriberKind,
    subscriberRef,
    channel,
    address,
    filter,
    isActive,
    createdAt,
    lastActiveAt
  }) {
    if (!id) throw new ValidationError('Subscription.id is required');
    if (!SUBSCRIBER_KINDS.has(subscriberKind)) {
      throw new ValidationError(`Invalid subscriberKind: ${subscriberKind}`);
    }
    if (!subscriberRef) throw new ValidationError('Subscription.subscriberRef is required');
    if (!(channel instanceof Channel)) {
      throw new ValidationError('Subscription.channel must be a Channel VO');
    }
    if (!(address instanceof EndpointAddress)) {
      throw new ValidationError('Subscription.address must be an EndpointAddress VO');
    }
    if (address.channel !== channel.value) {
      throw new ValidationError(
        `EndpointAddress channel (${address.channel}) does not match subscription channel (${channel.value})`
      );
    }
    if (!(filter instanceof Filter)) {
      throw new ValidationError('Subscription.filter must be a Filter VO');
    }

    this.id = id;
    this.subscriberKind = subscriberKind;
    this.subscriberRef = subscriberRef;
    this.channel = channel;
    this.address = address;
    this.filter = filter;
    this.isActive = isActive !== false;
    this.createdAt = createdAt ?? new Date().toISOString();
    this.lastActiveAt = lastActiveAt ?? null;

    Object.freeze(this);
  }

  static create({
    subscriberKind,
    subscriberRef,
    channel,
    address,
    filter,
    id,
    now
  }) {
    const ch = channel instanceof Channel ? channel : Channel.of(channel);
    const addr =
      address instanceof EndpointAddress
        ? address
        : EndpointAddress.of({ channel: ch.value, value: address });
    const flt = filter instanceof Filter ? filter : Filter.of(filter);
    return new Subscription({
      id: id ?? randomUUID(),
      subscriberKind,
      subscriberRef,
      channel: ch,
      address: addr,
      filter: flt,
      isActive: true,
      createdAt: now ? new Date(now).toISOString() : new Date().toISOString(),
      lastActiveAt: null
    });
  }

  activate() {
    if (this.isActive) return this;
    return new Subscription({ ...this._asProps(), isActive: true });
  }

  deactivate() {
    if (!this.isActive) return this;
    return new Subscription({ ...this._asProps(), isActive: false });
  }

  recordSeen(now) {
    if (!this.isActive) {
      throw new ValidationError('Cannot record activity on a deactivated subscription');
    }
    const ts = now ? new Date(now).toISOString() : new Date().toISOString();
    return new Subscription({ ...this._asProps(), lastActiveAt: ts });
  }

  _asProps() {
    return {
      id: this.id,
      subscriberKind: this.subscriberKind,
      subscriberRef: this.subscriberRef,
      channel: this.channel,
      address: this.address,
      filter: this.filter,
      isActive: this.isActive,
      createdAt: this.createdAt,
      lastActiveAt: this.lastActiveAt
    };
  }

  toJSON() {
    return {
      id: this.id,
      subscriberKind: this.subscriberKind,
      subscriberRef: this.subscriberRef,
      channel: this.channel.value,
      address: this.address.toJSON(),
      filter: this.filter.toJSON(),
      isActive: this.isActive,
      createdAt: this.createdAt,
      lastActiveAt: this.lastActiveAt
    };
  }
}
