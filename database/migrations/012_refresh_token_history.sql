-- 012_refresh_token_history.sql
-- Identity & Access: refresh-token reuse detection (OAuth 2.0 Security BCP,
-- RFC 9700 §4.14.2).
--
-- Refresh tokens already rotate on every use (user_sessions.session_token
-- holds the hash of the current one). This table remembers the hashes that
-- were rotated away, so a replayed old token is recognised as reuse — the
-- signal that it leaked — and the whole session is revoked, instead of a
-- plain 401 that leaves the attacker's (or victim's) newer token alive.
--
-- Rows die with their session (ON DELETE CASCADE). Hashes only, never raw
-- tokens.

CREATE TABLE IF NOT EXISTS refresh_token_history (
  token_hash VARCHAR(255) PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES user_sessions(id) ON DELETE CASCADE,
  superseded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refresh_token_history_session
  ON refresh_token_history (session_id);
