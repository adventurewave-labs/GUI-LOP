-- 003 Outbox, idempotency, and dead-letter tables
-- Supports ADR 0014 (transactional outbox) and ADR 0024 (idempotency).
-- Forward-only migration; pair with a future 003_down.sql if rollback needed.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------------------
-- Outbox: durable buffer for domain events written transactionally with
-- aggregate state and dispatched out-of-band by the outbox publisher.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS outbox (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id        UUID UNIQUE NOT NULL,
    event_type      TEXT NOT NULL,
    event_version   INT NOT NULL DEFAULT 1,
    aggregate_id    UUID,
    aggregate_type  TEXT,
    payload         JSONB NOT NULL,
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    dispatched_at   TIMESTAMPTZ,
    status          TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','dispatched','failed','dead_letter')),
    retry_count     INT NOT NULL DEFAULT 0,
    last_error      TEXT,
    correlation_id  UUID,
    causation_id    UUID
);

CREATE INDEX IF NOT EXISTS idx_outbox_status_occurred_at
    ON outbox (status, occurred_at);
CREATE INDEX IF NOT EXISTS idx_outbox_event_type
    ON outbox (event_type);
CREATE INDEX IF NOT EXISTS idx_outbox_aggregate_id
    ON outbox (aggregate_id);

-- ---------------------------------------------------------------------------
-- Idempotency keys: cached responses for safely-replayable mutating requests
-- (ADR 0024). Unique on (actor, route, key) so the same key may be reused on
-- different routes.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS idempotency_keys (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    actor_id         UUID,
    route            TEXT NOT NULL,
    idempotency_key  TEXT NOT NULL,
    request_hash     TEXT NOT NULL,
    status_code      INT NOT NULL,
    response_body    JSONB,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at       TIMESTAMPTZ NOT NULL,
    UNIQUE (actor_id, route, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_idempotency_keys_expires_at
    ON idempotency_keys (expires_at);

-- ---------------------------------------------------------------------------
-- Dead letters: poison events that exhausted retries; manually inspected.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dead_letters (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_event_id   UUID,
    payload           JSONB NOT NULL,
    reason            TEXT NOT NULL,
    attempts          INT NOT NULL,
    first_attempt_at  TIMESTAMPTZ,
    last_attempt_at   TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
