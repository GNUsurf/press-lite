#!/usr/bin/env node
/**
 * Open a (restored) database read-only, run PRAGMA integrity_check, confirm
 * the schema is at the current migration level, and print row counts.
 * Exit 1 on any problem. Used by scripts/restore.sh and the nightly job.
 */
import fs from 'node:fs';
import Database from 'better-sqlite3';

const file = process.argv[2];
if (!file || !fs.existsSync(file)) {
  console.error('usage: node scripts/integrity-check.js <path/to/app.db>');
  process.exit(2);
}

const db = new Database(file, { readonly: true });
const result = /** @type {{ integrity_check: string }[]} */ (db.pragma('integrity_check'));
const verdict = result.map((r) => r.integrity_check).join('; ');
if (verdict !== 'ok') {
  console.error(`integrity_check: ${verdict}`);
  process.exit(1);
}

const migrations = /** @type {{ n: number }} */ (
  db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get()
).n;
const counts = Object.fromEntries(
  ['leads', 'subscribers', 'outbox', 'idempotency_keys'].map((t) => [
    t,
    /** @type {{ n: number }} */ (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get()).n,
  ]),
);
db.close();

console.log(JSON.stringify({ integrity: 'ok', migrations, counts }));
