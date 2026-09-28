-- Timestamps are UTC ISO-8601 text ending in Z. They compare correctly as text.

CREATE TABLE leads (
  id           INTEGER PRIMARY KEY,
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  version      INTEGER NOT NULL DEFAULT 1,
  name         TEXT    NOT NULL,
  email        TEXT    NOT NULL,
  company      TEXT,
  message      TEXT    NOT NULL,
  source       TEXT,
  status       TEXT    NOT NULL DEFAULT 'new'
               CHECK (status IN ('new', 'contacted', 'qualified', 'won', 'lost')),
  tags         TEXT    NOT NULL DEFAULT '[]',   -- JSON array of strings
  notes        TEXT    NOT NULL DEFAULT '',
  form_id      TEXT    UNIQUE,                  -- UUID from the page script; NULL without JS
  dedupe_hash  TEXT    NOT NULL                 -- sha256(email + message) for the no-JS window
);
CREATE INDEX leads_created_at_id ON leads (created_at, id);
CREATE INDEX leads_dedupe ON leads (dedupe_hash, created_at);

CREATE TABLE subscribers (
  id           INTEGER PRIMARY KEY,
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  email        TEXT    NOT NULL,
  list         TEXT    NOT NULL,                -- 'newsletter' or 'magnet:<slug>'
  source       TEXT,
  form_id      TEXT    UNIQUE,
  dedupe_hash  TEXT    NOT NULL                 -- sha256(email + list)
);
CREATE INDEX subscribers_dedupe ON subscribers (dedupe_hash, created_at);

-- Transactional outbox: written in the same transaction as the domain row,
-- delivered to n8n by src/worker/outbox.js. At-least-once.
CREATE TABLE outbox (
  id               INTEGER PRIMARY KEY,
  event_id         TEXT    NOT NULL UNIQUE,     -- UUID; n8n dedupes on this
  event_type       TEXT    NOT NULL,
  occurred_at      TEXT    NOT NULL,
  payload          TEXT    NOT NULL,            -- JSON `data`
  created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  status           TEXT    NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'delivered', 'dead')),
  attempts         INTEGER NOT NULL DEFAULT 0,
  next_attempt_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  dead_after       TEXT    NOT NULL,            -- give up after this; reset by a manual retry
  lease_until      TEXT,
  delivered_at     TEXT,
  last_error       TEXT
);
CREATE INDEX outbox_due ON outbox (status, next_attempt_at);

-- Idempotency records for the v1 API, kept for 24 hours.
CREATE TABLE idempotency_keys (
  key_name         TEXT    NOT NULL,            -- API key name, so keys don't collide across callers
  idempotency_key  TEXT    NOT NULL,
  request_hash     TEXT    NOT NULL,
  status           TEXT    NOT NULL DEFAULT 'in_progress'
                   CHECK (status IN ('in_progress', 'completed')),
  response_status  INTEGER,
  response_body    TEXT,
  created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (key_name, idempotency_key)
);
CREATE INDEX idempotency_keys_created_at ON idempotency_keys (created_at);
