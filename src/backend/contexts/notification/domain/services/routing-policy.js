/**
 * RoutingPolicy — pure function returning the set of subscriptions that should
 * receive a given event.
 */

export class RouteSet {
  constructor(routes = []) {
    this.routes = Object.freeze([...routes]);
    Object.freeze(this);
  }

  get size() {
    return this.routes.length;
  }

  byChannel(channel) {
    return this.routes.filter((r) => r.subscription.channel.value === channel);
  }

  isEmpty() {
    return this.routes.length === 0;
  }
}

/**
 * Determine which subscriptions match a given event.
 * @param {object} event
 * @param {Array} subscriptions
 */
export function routesFor(event, subscriptions) {
  const matched = [];
  for (const sub of subscriptions) {
    if (!sub.isActive) continue;
    if (sub.filter.matches(event)) {
      matched.push({ subscription: sub });
    }
  }
  return new RouteSet(matched);
}
