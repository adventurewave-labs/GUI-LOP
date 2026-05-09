# 0022. Configuration and Secrets Management

- **Status:** Accepted
- **Date:** 2025-10-26
- **Deciders:** Security team, Platform team
- **Tags:** security, configuration, secrets

## Context

The platform reads many configuration values: database URLs, Redis
hosts, JWT signing keys, third-party AI provider credentials, CORS
origins, feature flags, rate-limit budgets. Mismanaging these is the
single largest source of production incidents and security
disclosures in similar platforms.

## Decision

- **12-factor configuration**: all environment-specific values come
  from environment variables. Code never reads files in the source
  tree for production config.
- **Schema-validated config loader**: a single module loads,
  type-coerces, and validates configuration on startup. Missing or
  malformed values fail fast with a clear error. The loader is the
  only place that reads `process.env`.
- **Secrets**:
  - **Never** stored in the repository, in environment files
    committed to git, or in container images.
  - In production, sourced from a secrets manager (AWS Secrets
    Manager, GCP Secret Manager, Vault) and injected at runtime
    (file mount or sidecar).
  - In dev, sourced from `.env.local` (gitignored). `.env.example`
    documents the keys.
  - Rotated per a documented schedule; rotation does not require a
    redeploy where possible (file watchers reload signing keys).
- **Feature flags**: a small flag service (initially backed by a
  config table; later a vendor) controls runtime toggles. Flags
  expire — a flag without a removal date is a code smell.

## Alternatives Considered

- **Configuration files in git** — trivial, but secrets leak; a
  single mistake is catastrophic. Rejected.
- **Application database for config** — viable for non-secret
  values; we do this for flags, not for connection strings.

## Consequences

### Positive

- Image is environment-agnostic.
- Secrets are auditable and rotatable.
- Misconfiguration fails the deploy, not the request.

### Negative / Trade-offs

- Local setup requires a populated `.env.local`; documented in the
  README.
- Secrets manager access is a runtime dependency; we cache values
  with a short TTL.

### Neutral

- The config loader is part of the shared kernel.

## Compliance and Verification

- A pre-commit hook scans for secret-shaped strings.
- A CI step validates `.env.example` matches the schema.
- Secret rotation is tested in staging quarterly.

## References

- The Twelve-Factor App (https://12factor.net)
- `.env.example`
