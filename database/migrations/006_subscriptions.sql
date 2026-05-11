-- 006_subscriptions.sql
-- Notification & Realtime context: subscriptions and delivery attempts.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subscriber_kind TEXT NOT NULL CHECK (subscriber_kind IN ('user','webhook')),
  subscriber_ref TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('websocket','email','webhook')),
  address TEXT NOT NULL,
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_active_channel
  ON subscriptions (channel) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_subscriptions_subscriber
  ON subscriptions (subscriber_kind, subscriber_ref);

CREATE TABLE IF NOT EXISTS delivery_attempts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subscription_id UUID REFERENCES subscriptions(id) ON DELETE CASCADE,
  event_id UUID,
  attempt_number INT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_delivery_attempts_event
  ON delivery_attempts (event_id);

CREATE INDEX IF NOT EXISTS idx_delivery_attempts_subscription
  ON delivery_attempts (subscription_id);

CREATE TABLE IF NOT EXISTS dead_letters (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subscription_id UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
  event_id UUID,
  envelope JSONB NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dead_letters_created
  ON dead_letters (created_at DESC);
