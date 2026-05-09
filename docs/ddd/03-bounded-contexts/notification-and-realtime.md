# Bounded Context: Notification & Realtime

> **Subdomain.** Supporting.
> **Status.** Active.
> **Owner.** Platform team.
> **Code.** `src/backend/contexts/notification/`

## Purpose

Subscribe to domain events from other contexts and deliver them to
the right recipients on the right channels with the right
guarantees: WebSocket push for the SPA, email and webhook for
external destinations.

## Ubiquitous Language (Local Additions)

- **Subscriber** — a connected client (WebSocket session) or a
  registered external endpoint.
- **Subscription** — a record describing what events a subscriber
  receives, with optional filters (by workflow id, by event type).
- **Channel** — a transport: `websocket`, `email`, `webhook`.
- **Envelope** — the JSON wrapper sent over the wire.
- **Delivery Attempt** — an instance of trying to deliver an
  envelope to one endpoint.
- **Dead Letter** — a delivery that has exhausted retries.

## Aggregates

### `Subscription`

```
Subscription
├── identity: SubscriptionId
├── subscriber_kind: 'user' | 'webhook'
├── subscriber_ref: UserId | EndpointAddress
├── channel: Channel (VO)
├── filters: Filter[] (VO)
├── is_active
├── created_at, last_active_at
└── pending_events
```

Invariants:

- A user has at most one active WebSocket subscription per active
  connection.
- Webhook subscriptions store a hashed signing secret only.

## Domain Services

- `RoutingPolicy.routesFor(event, subscriptions): RouteSet`
- `RetryPolicy.next(attempt): Backoff | DeadLetter`
- `EnvelopeBuilder.build(event, subscription): Envelope`

## Use Cases

### Commands

- `Subscribe({ user, channel, filters })`
- `Unsubscribe({ subscription_id })`
- `RegisterWebhook({ url, signing_secret, filters, owner })`
- `DeliverEvent({ event })` — internal; dispatches to all matching
  subscriptions.
- `RetryDeadLetter({ id })` — admin-only.

### Queries

- `ListSubscriptions(filter)`
- `ListDeadLetters(filter)`

## Repositories

- `SubscriptionRepository`
- `DeliveryAttemptRepository` (append-only)
- `DeadLetterRepository`

## Inbound Adapters

### WebSocket Server

- Authenticates the upgrade.
- Creates a `Subscription` for the session.
- Pumps inbound messages through `Subscribe`/`Unsubscribe` use
  cases as needed.
- Pushes `Envelope`s to the connection on outbound delivery.

### REST (admin)

| Method | Path                                  | Use Case             |
| ------ | ------------------------------------- | -------------------- |
| GET    | `/api/v1/subscriptions`               | `ListSubscriptions`  |
| DELETE | `/api/v1/subscriptions/:id`           | `Unsubscribe`        |
| POST   | `/api/v1/webhooks`                    | `RegisterWebhook`    |
| GET    | `/api/v1/dead-letters`                | `ListDeadLetters`    |
| POST   | `/api/v1/dead-letters/:id/retry`      | `RetryDeadLetter`    |

### Outbox Consumer

The transactional outbox publisher invokes `DeliverEvent` for every
dispatched event. This is the only producer of `DeliverEvent`.

## Outbound Dependencies

- **Email Provider** (ACL).
- **Webhook HTTP client** (with signing).
- **Redis Pub/Sub** for cross-instance WebSocket fan-out.

## Domain Events Produced

- `notification.delivered`
- `notification.failed`
- (`subscription.created`, `subscription.removed` — internal.)

## Persistence

- `subscriptions`
- `delivery_attempts`
- `dead_letters`

## Delivery Guarantees

- **WebSocket**: at-most-once per connection. If the connection is
  not active, the event is *not* persisted as a notification; the
  user instead sees the new state when they reconnect (the read
  models are the source of truth).
- **Webhook / Email**: at-least-once with exponential backoff and a
  dead-letter queue.
- **Idempotency**: every envelope carries the source event id;
  subscribers must dedupe.

## Risks and Pitfalls

- **Storm**: a single event with many subscribers can fan out to
  thousands of deliveries. Rate limits apply per channel; webhooks
  have per-endpoint concurrency caps.
- **Slow consumer**: a slow webhook endpoint should not block
  others. Delivery is per-subscription with isolated workers.
- **Sensitive payloads**: events carry just enough information;
  full data is fetched by the subscriber via authenticated REST.

## Open Questions

- **Push notifications (mobile)**: not in v1.
- **Webhook signature standard**: HMAC-SHA-256 over `(timestamp,
  body)` with a recent timestamp window; documented in the public
  API docs.
