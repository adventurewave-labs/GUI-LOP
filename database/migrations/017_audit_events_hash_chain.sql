-- 017: a real, tamper-evident audit trail.
--
-- Production bug: the audit API read from `events` and `audit_logs` using
-- columns those (legacy) tables do not have, and nothing wrote domain events
-- to either table. On Postgres the audit trail was therefore empty at best
-- and a 500 at worst — only the in-memory mode ever showed anything.
--
-- `audit_events` is an append-only, hash-chained copy of every domain event.
-- It is filled by a trigger on `outbox`, i.e. in the SAME transaction as the
-- business change: an event cannot be committed without its audit entry, and
-- no application code path can forget to write one.
--
--   hash(n) = sha256( canonical(prev_hash, seq, event fields) )
--
-- so editing a row, deleting a row from the middle, or reordering rows breaks
-- the chain at that point (`audit_chain_first_break()`). UPDATE, DELETE and
-- TRUNCATE are refused by triggers. `seq` is gapless (assigned under the
-- chain lock, not from a sequence).
--
-- Limits, stated plainly: someone with DDL rights can drop the triggers and
-- rewrite the whole chain, and deleting the newest rows leaves a valid
-- (shorter) chain. Both are detectable only against a head (seq + hash)
-- recorded outside the database — see docs/RUNBOOK.md "Audit trail integrity".

CREATE TABLE IF NOT EXISTS audit_events (
  seq             BIGINT PRIMARY KEY,
  event_id        UUID NOT NULL UNIQUE,
  event_type      TEXT NOT NULL,
  event_version   INTEGER NOT NULL DEFAULT 1,
  aggregate_type  TEXT,
  aggregate_id    TEXT,
  actor_id        TEXT,
  payload         JSONB NOT NULL,
  correlation_id  TEXT,
  occurred_at     TIMESTAMPTZ NOT NULL,
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  prev_hash       TEXT NOT NULL,
  hash            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_events_aggregate ON audit_events (aggregate_type, aggregate_id, seq);
CREATE INDEX IF NOT EXISTS idx_audit_events_actor ON audit_events (actor_id, seq) WHERE actor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_events_occurred_at ON audit_events (occurred_at);

-- Canonical hash of one entry. jsonb_build_array gives an unambiguous
-- encoding (no separator games) and jsonb's text form is deterministic.
CREATE OR REPLACE FUNCTION audit_event_hash(
  p_prev_hash TEXT, p_seq BIGINT, p_event_id UUID, p_event_type TEXT, p_event_version INTEGER,
  p_aggregate_type TEXT, p_aggregate_id TEXT, p_actor_id TEXT, p_payload JSONB,
  p_correlation_id TEXT, p_occurred_at TIMESTAMPTZ
) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(jsonb_build_array(
    p_prev_hash, p_seq, p_event_id::text, p_event_type, p_event_version,
    p_aggregate_type, p_aggregate_id, p_actor_id, p_payload, p_correlation_id,
    to_char(p_occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  )::text, 'UTF8')), 'hex')
$$;

CREATE OR REPLACE FUNCTION audit_events_append_from_outbox() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_prev_seq  BIGINT;
  v_prev_hash TEXT;
  v_seq       BIGINT;
  v_actor     TEXT;
BEGIN
  -- One writer at a time extends the chain; held until this transaction ends.
  PERFORM pg_advisory_xact_lock(4273659182736451);
  SELECT seq, hash INTO v_prev_seq, v_prev_hash FROM audit_events ORDER BY seq DESC LIMIT 1;
  v_seq := COALESCE(v_prev_seq, 0) + 1;
  v_prev_hash := COALESCE(v_prev_hash, repeat('0', 64));
  v_actor := COALESCE(
    NEW.payload->>'actorId', NEW.payload->>'actor_id', NEW.payload->>'userId', NEW.payload->>'user_id',
    NEW.payload->>'respondedBy', NEW.payload->>'createdBy', NEW.payload->>'created_by');
  INSERT INTO audit_events (seq, event_id, event_type, event_version, aggregate_type, aggregate_id, actor_id,
                            payload, correlation_id, occurred_at, prev_hash, hash)
  VALUES (v_seq, NEW.event_id, NEW.event_type, NEW.event_version, NEW.aggregate_type, NEW.aggregate_id, v_actor,
          NEW.payload, NEW.correlation_id, NEW.occurred_at, v_prev_hash,
          audit_event_hash(v_prev_hash, v_seq, NEW.event_id, NEW.event_type, NEW.event_version,
                           NEW.aggregate_type, NEW.aggregate_id, v_actor, NEW.payload, NEW.correlation_id, NEW.occurred_at));
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_outbox_audit_append ON outbox;
CREATE TRIGGER trg_outbox_audit_append AFTER INSERT ON outbox
  FOR EACH ROW EXECUTE FUNCTION audit_events_append_from_outbox();

CREATE OR REPLACE FUNCTION audit_events_refuse_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only (% refused)', TG_OP USING ERRCODE = 'insufficient_privilege';
END $$;

DROP TRIGGER IF EXISTS trg_audit_events_immutable ON audit_events;
CREATE TRIGGER trg_audit_events_immutable BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_refuse_change();
DROP TRIGGER IF EXISTS trg_audit_events_no_truncate ON audit_events;
CREATE TRIGGER trg_audit_events_no_truncate BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION audit_events_refuse_change();

-- First entry at which the chain does not hold (NULL = intact): a changed
-- row, a wrong link to its predecessor, or a missing seq.
CREATE OR REPLACE FUNCTION audit_chain_first_break() RETURNS BIGINT
LANGUAGE sql STABLE AS $$
  SELECT min(seq) FROM (
    SELECT seq, hash, prev_hash,
           lag(hash) OVER (ORDER BY seq) AS expected_prev,
           lag(seq)  OVER (ORDER BY seq) AS previous_seq,
           audit_event_hash(prev_hash, seq, event_id, event_type, event_version, aggregate_type, aggregate_id,
                            actor_id, payload, correlation_id, occurred_at) AS recomputed
      FROM audit_events
  ) c
  WHERE hash <> recomputed
     OR prev_hash <> COALESCE(expected_prev, repeat('0', 64))
     OR seq <> COALESCE(previous_seq, 0) + 1
$$;

-- Events that were committed before this migration: chain them in their
-- original order so history is not silently missing from the trail.
DO $$
DECLARE r RECORD; v_prev TEXT; v_seq BIGINT; v_actor TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM audit_events) THEN RETURN; END IF;
  v_prev := repeat('0', 64); v_seq := 0;
  FOR r IN SELECT * FROM outbox ORDER BY occurred_at, created_at, id LOOP
    v_seq := v_seq + 1;
    v_actor := COALESCE(r.payload->>'actorId', r.payload->>'actor_id', r.payload->>'userId', r.payload->>'user_id',
                        r.payload->>'respondedBy', r.payload->>'createdBy', r.payload->>'created_by');
    INSERT INTO audit_events (seq, event_id, event_type, event_version, aggregate_type, aggregate_id, actor_id,
                              payload, correlation_id, occurred_at, prev_hash, hash)
    VALUES (v_seq, r.event_id, r.event_type, r.event_version, r.aggregate_type, r.aggregate_id, v_actor,
            r.payload, r.correlation_id, r.occurred_at, v_prev,
            audit_event_hash(v_prev, v_seq, r.event_id, r.event_type, r.event_version, r.aggregate_type,
                             r.aggregate_id, v_actor, r.payload, r.correlation_id, r.occurred_at));
    SELECT hash INTO v_prev FROM audit_events WHERE seq = v_seq;
  END LOOP;
END $$;
