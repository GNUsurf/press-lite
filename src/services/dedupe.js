/**
 * Double-submit protection shared by leads and subscribers.
 *
 * With JavaScript on, the page sends a UUID `form_id`, which is UNIQUE in the
 * table. Without it, a hash of the identifying fields within a 10-minute
 * window stands in. Either way a double-click yields one row.
 */
import { sha256 } from '../lib/crypto.js';
import { MINUTE, toIso, fromIso } from '../lib/time.js';

export const DEDUPE_WINDOW_MS = 10 * MINUTE;

const TABLES = /** @type {const} */ (['leads', 'subscribers']);

/** @param {string[]} parts */
export function dedupeHash(...parts) {
  return sha256(parts.map((p) => p.trim().toLowerCase()).join('\n'));
}

/**
 * @template T
 * @param {import('../db/index.js').Db} db
 * @param {typeof TABLES[number]} table
 * @param {{ formId: string | null, hash: string, nowIso: string }} match
 * @returns {T | undefined}
 */
export function findDuplicate(db, table, { formId, hash, nowIso }) {
  if (!TABLES.includes(table)) throw new Error(`unknown table ${table}`);
  const since = toIso(fromIso(nowIso) - DEDUPE_WINDOW_MS);
  return /** @type {T | undefined} */ (
    db
      .prepare(
        `SELECT * FROM ${table}
         WHERE (form_id IS NOT NULL AND form_id = ?) OR (dedupe_hash = ? AND created_at >= ?)
         ORDER BY id LIMIT 1`,
      )
      .get(formId, hash, since)
  );
}

/** better-sqlite3 error for a UNIQUE violation (a race on form_id). */
export function isUniqueViolation(/** @type {unknown} */ err) {
  return /** @type {{code?: string}} */ (err)?.code === 'SQLITE_CONSTRAINT_UNIQUE';
}
