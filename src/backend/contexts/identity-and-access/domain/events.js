/**
 * Domain events emitted by the Identity & Access bounded context.
 *
 * Bridges the compact Phase 1 event API to the strict Phase 0 DomainEvent
 * envelope by filling sensible defaults for fields the callers do not
 * always supply (`eventId`, `eventVersion`, `occurredAt`, `correlationId`,
 * `actor`).
 */
import { randomUUID } from 'node:crypto';
import { DomainEvent } from '../../../shared-kernel/domain/domain-event.js';

const AGG_USER = 'User';
const AGG_SESSION = 'Session';

function envelope({
  eventType,
  aggregateId,
  aggregateType,
  payload,
  occurredAt,
  correlationId,
  actor,
  eventId,
  eventVersion,
}) {
  return {
    eventId: eventId ?? randomUUID(),
    eventType,
    eventVersion: eventVersion ?? 1,
    occurredAt:
      occurredAt instanceof Date
        ? occurredAt.toISOString()
        : occurredAt ?? new Date().toISOString(),
    aggregateId,
    aggregateType,
    correlationId: correlationId ?? randomUUID(),
    actor: actor ?? { type: 'system' },
    payload: payload ?? {},
  };
}

export class UserRegistered extends DomainEvent {
  constructor({ userId, email, username, role, occurredAt, correlationId, actor }) {
    super(envelope({
      eventType: 'user.registered',
      aggregateId: userId,
      aggregateType: AGG_USER,
      payload: { userId, email, username, role },
      occurredAt,
      correlationId,
      actor,
    }));
  }
}

export class UserDeactivated extends DomainEvent {
  constructor({ userId, occurredAt, correlationId, actor }) {
    super(envelope({
      eventType: 'user.deactivated',
      aggregateId: userId,
      aggregateType: AGG_USER,
      payload: { userId },
      occurredAt,
      correlationId,
      actor,
    }));
  }
}

export class UserReactivated extends DomainEvent {
  constructor({ userId, occurredAt, correlationId, actor }) {
    super(envelope({
      eventType: 'user.reactivated',
      aggregateId: userId,
      aggregateType: AGG_USER,
      payload: { userId },
      occurredAt,
      correlationId,
      actor,
    }));
  }
}

export class UserEmailChanged extends DomainEvent {
  constructor({ userId, oldEmail, newEmail, occurredAt, correlationId, actor }) {
    super(envelope({
      eventType: 'user.email_changed',
      aggregateId: userId,
      aggregateType: AGG_USER,
      payload: { userId, oldEmail, newEmail },
      occurredAt,
      correlationId,
      actor,
    }));
  }
}

export class UserUsernameChanged extends DomainEvent {
  constructor({ userId, oldUsername, newUsername, occurredAt, correlationId, actor }) {
    super(envelope({
      eventType: 'user.username_changed',
      aggregateId: userId,
      aggregateType: AGG_USER,
      payload: { userId, oldUsername, newUsername },
      occurredAt,
      correlationId,
      actor,
    }));
  }
}

export class UserPasswordChanged extends DomainEvent {
  constructor({ userId, occurredAt, correlationId, actor }) {
    super(envelope({
      eventType: 'user.password_changed',
      aggregateId: userId,
      aggregateType: AGG_USER,
      payload: { userId },
      occurredAt,
      correlationId,
      actor,
    }));
  }
}

export class UserAuthenticated extends DomainEvent {
  constructor({ userId, sessionId, ip, occurredAt, correlationId, actor }) {
    super(envelope({
      eventType: 'user.authenticated',
      aggregateId: userId,
      aggregateType: AGG_USER,
      payload: { userId, sessionId, ip },
      occurredAt,
      correlationId,
      actor: actor ?? (userId ? { type: 'user', id: userId } : undefined),
    }));
  }
}

export class UserAuthenticationFailed extends DomainEvent {
  constructor({ identifier, ip, reason, occurredAt, correlationId, actor }) {
    super(envelope({
      eventType: 'user.authentication_failed',
      aggregateId: identifier ?? 'unknown',
      aggregateType: AGG_USER,
      payload: { identifier, ip, reason },
      occurredAt,
      correlationId,
      actor,
    }));
  }
}

export class SessionCreated extends DomainEvent {
  constructor({ sessionId, userId, ip, occurredAt, correlationId, actor }) {
    super(envelope({
      eventType: 'session.created',
      aggregateId: sessionId,
      aggregateType: AGG_SESSION,
      payload: { sessionId, userId, ip },
      occurredAt,
      correlationId,
      actor: actor ?? (userId ? { type: 'user', id: userId } : undefined),
    }));
  }
}

export class SessionRefreshed extends DomainEvent {
  constructor({ sessionId, userId, occurredAt, correlationId, actor }) {
    super(envelope({
      eventType: 'session.refreshed',
      aggregateId: sessionId,
      aggregateType: AGG_SESSION,
      payload: { sessionId, userId },
      occurredAt,
      correlationId,
      actor: actor ?? (userId ? { type: 'user', id: userId } : undefined),
    }));
  }
}

export class SessionRevoked extends DomainEvent {
  constructor({ sessionId, userId, occurredAt, correlationId, actor }) {
    super(envelope({
      eventType: 'session.revoked',
      aggregateId: sessionId,
      aggregateType: AGG_SESSION,
      payload: { sessionId, userId },
      occurredAt,
      correlationId,
      actor: actor ?? (userId ? { type: 'user', id: userId } : undefined),
    }));
  }
}

export class RoleGranted extends DomainEvent {
  constructor({ userId, role, occurredAt, correlationId, actor }) {
    super(envelope({
      eventType: 'role.granted',
      aggregateId: userId,
      aggregateType: AGG_USER,
      payload: { userId, role },
      occurredAt,
      correlationId,
      actor,
    }));
  }
}

export class PermissionGranted extends DomainEvent {
  constructor({ userId, permission, scope, occurredAt, correlationId, actor }) {
    super(envelope({
      eventType: 'permission.granted',
      aggregateId: userId,
      aggregateType: AGG_USER,
      payload: { userId, permission, scope },
      occurredAt,
      correlationId,
      actor,
    }));
  }
}

export class PermissionRevoked extends DomainEvent {
  constructor({ userId, permission, scope, occurredAt, correlationId, actor }) {
    super(envelope({
      eventType: 'permission.revoked',
      aggregateId: userId,
      aggregateType: AGG_USER,
      payload: { userId, permission, scope },
      occurredAt,
      correlationId,
      actor,
    }));
  }
}
