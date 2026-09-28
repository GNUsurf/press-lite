import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { openDatabase, applyMigrations, isDatabaseUnavailable } from '../src/db/index.js';
import { tmpDir } from './helpers.js';

test('migrations apply to an empty database and are a no-op the second time', () => {
  const dir = tmpDir();
  const db = openDatabase(dir);
  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
    .all()
    .map((r) => /** @type {{name: string}} */ (r).name);
  for (const t of ['leads', 'subscribers', 'outbox', 'idempotency_keys', 'schema_migrations']) {
    assert.ok(tables.includes(t), `missing table ${t}`);
  }
  assert.deepEqual(applyMigrations(db), []);
  assert.equal(db.pragma('journal_mode', { simple: true }), 'wal');
  assert.equal(db.pragma('busy_timeout', { simple: true }), 5000);
  db.close();
  assert.ok(fs.existsSync(path.join(dir, 'app.db')));
});

test('a fresh connection to the same file sees the migrations as applied', () => {
  const dir = tmpDir();
  openDatabase(dir).close();
  const db = new Database(path.join(dir, 'app.db'));
  assert.deepEqual(applyMigrations(db), []);
  db.close();
});

test('isDatabaseUnavailable recognises lock/io errors only', () => {
  assert.ok(isDatabaseUnavailable({ code: 'SQLITE_BUSY' }));
  assert.ok(isDatabaseUnavailable({ code: 'SQLITE_IOERR_WRITE' }));
  assert.ok(!isDatabaseUnavailable({ code: 'SQLITE_CONSTRAINT_UNIQUE' }));
  assert.ok(!isDatabaseUnavailable(new Error('x')));
});
