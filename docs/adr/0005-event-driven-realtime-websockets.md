# 0005. Event-Driven Real-Time Communication via WebSockets

- **Status:** Accepted
- **Date:** 2025-10-26
- **Deciders:** Backend team, Frontend team
- **Tags:** realtime, websocket, eventing

## Context

GUI-LOP workflows pause for human input. Users need to know, with sub-
second latency, when:

- A workflow has finished an automated step and is awaiting their input.
- A dynamically generated UI is ready to be displayed.
- Another user has responded on a workflow they are watching.

Polling REST endpoints from the browser was tested in early prototypes
and produced visible lag, unnecessary load, and battery drain on mobile.

## Decision

We will use WebSockets (the `ws` library on the server) as the primary
real-time transport. The server publishes typed events; clients
subscribe by connecting and authenticating.

Conventions:

- Each WebSocket connection is bound to a session (ADR 0008) and
  authenticated on the upgrade request.
- Messages are JSON envelopes: `{ "type": "<event>", "payload": ... }`.
- Server-to-client events follow `<aggregate>.<verb>` (e.g.
  `workflow.completed`, `ui.generated`).
- Client-to-server messages are limited to keep-alives and explicit
  acknowledgements; mutations always go through HTTP.
- Inside the server, WebSocket fan-out is driven by a domain-event bus
  fed by the transactional outbox (ADR 0014). The WebSocket layer is an
  *adapter*, not a source of truth.

## Alternatives Considered

- **HTTP long-polling / SSE** — SSE is one-way and simpler, but we want
  ack-able client messages and richer interaction. Rejected for the main
  channel; SSE is a viable fallback for restrictive networks.
- **gRPC streaming** — strong typing, but poor browser support without a
  proxy. Rejected for browser clients; a future option for service-to-
  service streams.
- **MQTT / AMQP** — overkill for a browser-to-server channel; they may
  appear later for service-to-service messaging.

## Consequences

### Positive

- Single bidirectional channel per client; low latency.
- Decouples UI updates from user actions.
- Aligns with the event-driven domain model.

### Negative / Trade-offs

- WebSocket connections are stateful; load balancers must support
  sticky sessions or use a shared pub/sub layer (Redis, ADR 0007) to
  fan out messages across server instances.
- Requires careful auth and rate-limit handling on the upgrade path.
- Browser proxies and corporate firewalls sometimes block WebSockets;
  we need a fallback strategy (SSE or long-polling) for those cases.

### Neutral

- WebSocket payloads are versioned with the same scheme as HTTP APIs
  (ADR 0017).

## Compliance and Verification

- Every WebSocket message type is defined in a single
  `events.ts` per bounded context and validated at the boundary.
- Load tests in `tests/load/scenarios/websocket-load-test.js` exercise
  the fan-out path.
- Connection lifecycle (auth, idle timeout, ping/pong) is covered by
  integration tests.

## References

- WebSocket RFC 6455
- ADR 0007 — Redis for Pub/Sub
- ADR 0014 — Outbox Pattern
