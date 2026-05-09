# 0009. Role-Based Access Control with Resource-Scoped Permissions

- **Status:** Accepted
- **Date:** 2025-10-26
- **Deciders:** Security team, Product
- **Tags:** security, authorization, rbac

## Context

Workflows are sensitive: a single workflow might involve confidential
data, and human responses are auditable acts. The platform needs to
control:

- *Who* can create which kinds of workflows.
- *Who* can respond to a human-in-the-loop step on which workflow.
- *Who* can read the audit trail.
- *Who* can administer templates, users, roles, and system config.

The data model already provides a `user_role` enum (`admin`, `user`,
`viewer`) and a `permissions` JSONB column on roles.

## Decision

We will use Role-Based Access Control (RBAC) with three coarse roles
and resource-scoped permissions on top:

- **Roles** (coarse): `admin`, `user`, `viewer`.
- **Permissions** (fine, per resource): `workflow:create`,
  `workflow:read`, `workflow:execute`, `workflow:respond`,
  `template:manage`, `user:manage`, `audit:read`, etc.
- **Scoping**: a permission may be scoped to a workflow id, template
  key, or organization id (when ADR for multi-tenancy lands).
- The authorization check is implemented as a domain service in the
  `Identity & Access` bounded context and exposed to other contexts
  through a port; controllers never read role strings directly.

## Alternatives Considered

- **ACLs only** — flexible but unwieldy at scale; rejected.
- **ABAC (attribute-based)** — most flexible but overkill for current
  needs and harder to reason about for auditors. Considered for a
  later phase if and when policy complexity warrants it.

## Consequences

### Positive

- Auditable: every authorization decision can be logged with the
  user, the resource, and the permission checked.
- Fits cleanly behind a port; backends (DB-driven, OPA, etc.) can be
  swapped without touching call sites.

### Negative / Trade-offs

- Coarse roles plus fine permissions can become muddled; we mitigate
  with strict naming conventions and a `permissions.md` catalogue.
- Cross-cutting permissions (e.g. "viewer of any workflow tagged X")
  may push us toward ABAC eventually.

### Neutral

- Frontend mirrors the same permissions to drive UI affordances; the
  backend remains the source of truth.

## Compliance and Verification

- A test fixture ensures every protected endpoint has an explicit
  permission requirement.
- A nightly job audits roles vs. expected permission sets.

## References

- NIST RBAC standard
- `docs/SECURITY_AUTHENTICATION_DOCUMENTATION.md`
- ADR 0008 — JWT Authentication
