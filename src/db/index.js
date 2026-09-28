/**
 * Opens `$DATA_DIR/app.db`, sets pragmas, and applies numbered, forward-only
 * migrations from `./migrations`. Each migration runs in its own transaction
 * and is recorded in `schema_migrations`, so a second run is a no-op.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations/', import.meta.url));

/** @typedef {import('better-sqlite3').Database} Db */

/**
 * @param {string} dataDir
 * @param {{ memory?: boolean }} [options]  `memory` opens `:memory:` for tests
 * @returns {Db}
 */
export function openDatabase(dataDir, { memory = false } = {}) {
  let db;
  if (memory) {
    db = new Database(':memory:');
  } else {
    fs.mkdirSync(dataDir, { recursive: true });
    db = new Database(path.join(dataDir, 'app.db'));
    db.pragma('journal_mode = WAL');
  }
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  applyMigrations(db);
  return db;
}

/**
 * @param {Db} db
 * @returns {string[]} names of migrations applied by this call
 */
export function applyMigrations(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`);

  const applied = new Set(
    db
      .prepare('SELECT version FROM schema_migrations')
      .all()
      .map((row) => /** @type {{version: number}} */ (row).version),
  );
  const record = db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)');

  /** @type {string[]} */
  const ran = [];
  for (const { version, name, file } of listMigrations()) {
    if (applied.has(version)) continue;
    const sql = fs.readFileSync(file, 'utf8');
    db.transaction(() => {
      db.exec(sql);
      record.run(version, name);
    })();
    ran.push(name);
  }
  return ran;
}

function listMigrations() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{3}_.+\.sql$/.test(f))
    .sort()
    .map((f) => ({
      version: Number(f.slice(0, 3)),
      name: f.replace(/\.sql$/, ''),
      file: path.join(MIGRATIONS_DIR, f),
    }));
}

/**
 * True for SQLite errors that mean "try again later" rather than "bug":
 * the file is locked, missing, full or read-only.
 * @param {unknown} err
 */
export function isDatabaseUnavailable(err) {
  const code = /** @type {{ code?: string }} */ (err)?.code ?? '';
  return /^SQLITE_(BUSY|LOCKED|IOERR|CANTOPEN|FULL|READONLY|NOTADB|CORRUPT)/.test(code);
}
