-- v2: content lives in the database. Posts, site copy and assets are
-- versioned; every write leaves an audit row. Timestamps are UTC ISO text.

CREATE TABLE assets (
  id          TEXT    PRIMARY KEY,               -- uuid; file is $DATA_DIR/assets/<id>.<ext>
  ext         TEXT    NOT NULL CHECK (ext IN ('png', 'jpg', 'webp')),
  mime        TEXT    NOT NULL,
  bytes       INTEGER NOT NULL,
  width       INTEGER NOT NULL,
  height      INTEGER NOT NULL,
  sha256      TEXT    NOT NULL UNIQUE,           -- same bytes → same asset
  filename    TEXT,                              -- as uploaded, informational only
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by  TEXT    NOT NULL                   -- API key name, or 'seed'
);

CREATE TABLE posts (
  id             INTEGER PRIMARY KEY,
  slug           TEXT    NOT NULL UNIQUE,
  status         TEXT    NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft', 'published', 'unpublished', 'deleted')),
  head_version   INTEGER NOT NULL DEFAULT 1,     -- latest version (what PATCH edits, what preview shows)
  live_version   INTEGER,                        -- version on the public site; NULL when not published
  preview_token  TEXT    NOT NULL UNIQUE,
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  published_at   TEXT                            -- first publish; non-NULL means the slug is frozen
);
CREATE INDEX posts_status_updated ON posts (status, updated_at, id);

CREATE TABLE post_versions (
  id              INTEGER PRIMARY KEY,
  post_id         INTEGER NOT NULL REFERENCES posts(id),
  version         INTEGER NOT NULL,
  title           TEXT    NOT NULL,
  description     TEXT    NOT NULL,
  body            TEXT    NOT NULL,              -- Markdown; never HTML
  tags            TEXT    NOT NULL,              -- JSON array of strings
  cover_asset_id  TEXT    REFERENCES assets(id),
  date            TEXT    NOT NULL,              -- YYYY-MM-DD, the displayed date
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by      TEXT    NOT NULL,
  UNIQUE (post_id, version)
);

-- Exactly one row, id = 1. The shape is site.config.js.
CREATE TABLE site_copy (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  version     INTEGER NOT NULL DEFAULT 1,
  data        TEXT    NOT NULL,                  -- JSON
  updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE site_copy_versions (
  id          INTEGER PRIMARY KEY,
  version     INTEGER NOT NULL UNIQUE,
  data        TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by  TEXT    NOT NULL
);

-- Old URLs keep working: deleted posts point at /blog.
CREATE TABLE redirects (
  from_path   TEXT    PRIMARY KEY,
  to_path     TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Who did what. No content bodies, no PII.
CREATE TABLE audit (
  id           INTEGER PRIMARY KEY,
  at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  key_name     TEXT    NOT NULL,
  action       TEXT    NOT NULL,                 -- post.create, post.publish, site.update, asset.import, ...
  target_type  TEXT    NOT NULL,                 -- post | site | asset
  target_id    TEXT    NOT NULL,
  version      INTEGER,
  detail       TEXT                              -- small JSON: slug, from/to, ...
);
CREATE INDEX audit_at ON audit (at, id);
