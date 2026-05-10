import { DomainEvent } from '../shared-kernel-stubs.js';

const AGG_USER = 'User';
const AGG_SESSION = 'Session';

export class UserRegistered extends DomainEvent {
  constructor({ userId, email, username, role, occurredAt, correlationId }) {
    super({
      eventType: 'user.registered',
      aggregateId: userId,
      aggregateType: AGG_USER,
      payload: { userId, email, username, role },
      occurredAt,
      correlationId,
    });
  }
}

export class UserDeactivated extends DomainEvent {
  constructor({ userId, occurredAt, correlationId }) {
    super({
      eventType: 'user.deactivated',
      aggregateId: userId,
      aggregateType: AGG_USER,
      payload: { userId },
      occurredAt,
      correlationId,
    });
  }
}

export class UserReactivated extends DomainEvent {
  constructor({ userId, occurredAt, correlationId }) {
    super({
      eventType: 'user.reactivated',
      aggregateId: userId,
      aggregateType: AGG_USER,
      payload: { userId },
      occurredAt,
      correlationId,
    });
  }
}

export class UserEmailChanged extends DomainEvent {
  constructor({ userId, oldEmail, newEmail, occurredAt, correlationId }) {
    super({
      eventType: 'user.email_changed',
      aggregateId: userId,
      aggregateType: AGG_USER,
      payload: { userId, oldEmail, newEmail },
      occurredAt,
      correlationId,
    });
  }
}

export class UserUsernameChanged extends DomainEvent {
  constructor({ userId, oldUsername, newUsername, occurredAt, correlationId }) {
    super({
      eventType: 'user.username_changed',
      aggregateId: userId,
      aggregateType: AGG_USER,
      payload: { userId, oldUsername, newUsername },
      occurredAt,
      correlationId,
    });
  }
}

export class UserPasswordChanged extends DomainEvent {
  constructor({ userId, occurredAt, correlationId }) {
    super({
      eventType: 'user.password_changed',
      aggregateId: userId,
      aggregateType: AGG_USER,
      payload: { userId },
      occurredAt,
      correlationId,
    });
  }
}

export class UserAuthenticated extends DomainEvent {
  constructor({ userId, sessionId, ip, occurredAt, correlationId }) {
    super({
      eventType: 'user.authenticated',
      aggregateId: userId,
      aggregateType: AGG_USER,
      payload: { userId, sessionId, ip },
      occurredAt,
      correlationId,
    });
  }
}

export class UserAuthenticationFailed extends DomainEvent {
  constructor({ identifier, ip, reason, occurredAt, correlationId }) {
    super({
      eventType: 'user.authentication_failed',
      aggregateId: identifier ?? 'unknown',
      aggregateType: AGG_USER,
      payload: { identifier, ip, reason },
      occurredAt,
      correlationId,
    });
  }
}

export class SessionCreated extends DomainEvent {
  constructor({ sessionId, userId, ip, occurredAt, correlationId }) {
    super({
      eventType: 'session.created',
      aggregateId: sessionId,
      aggregateType: AGG_SESSION,
      payload: { sessionId, userId, ip },
      occurredAt,
      correlationId,
    });
  }
}

export class SessionRefreshed extends DomainEvent {
  constructor({ sessionId, userId, occurredAt, correlationId }) {
    super({
      eventType: 'session.refreshed',
      aggregateId: sessionId,
      aggregateType: AGG_SESSION,
      payload: { sessionId, userId },
      occurredAt,
      correlationId,
    });
  }
}

export class SessionRevoked extends DomainEvent {
  constructor({ sessionId, userId, occurredAt, correlationId }) {
    super({
      eventType: 'session.revoked',
      aggregateId: sessionId,
      aggregateType: AGG_SESSION,
      payload: { sessionId, userId },
      occurredAt,
      correlationId,
    });
  }
}

export class RoleGranted extends DomainEvent {
  constructor({ userId, role, occurredAt, correlationId }) {
    super({
      eventType: 'role.granted',
      aggregateId: userId,
      aggregateType: AGG_USER,
      payload: { userId, role },
      occurredAt,
      correlationId,
    });
  }
}

export class PermissionGranted extends DomainEvent {
  constructor({ userId, permission, scope, occurredAt, correlationId }) {
    super({
      eventType: 'permission.granted',
      aggregateId: userId,
      aggregateType: AGG_USER,
      payload: { userId, permission, scope },
      occurredAt,
      correlationId,
    });
  }
}

export class PermissionRevoked extends DomainEvent {
  constructor({ userId, permission, scope, occurredAt, correlationId }) {
    super({
      eventType: 'permission.revoked',
      aggregateId: userId,
      aggregateType: AGG_USER,
      payload: { userId, permission, scope },
      occurredAt,
      correlationId,
    });
  }
}
