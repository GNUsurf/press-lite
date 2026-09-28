/**
 * Idempotency records for v1 POST/PATCH. The record is inserted as
 * `in_progress` before any work happens, so a concurrent duplicate sees it
 * and gets 409, and a later duplicate replays the stored response.
 *
 * A record stuck `in_progress` for longer than STALE_MS means the process died
 * mid-request; the next identical request takes it over instead of getting
 * 409 forever. Records are purged after 24 hours by the outbox worker.
 */
import { HOUR, SECOND, toIso, fromIso } from '../lib/time.js';

export const RETENTION_MS = 24 * HOUR;
export const STALE_MS = 60 * SECOND;

/**
 * @typedef {object} IdempotencyRecord
 * @property {string} key_name
 * @property {string} idempotency_key
 * @property {string} request_hash
 * @property {'in_progress' | 'completed'} status
 * @property {number | null} response_status
 * @property {string | null} response_body
 * @property {string} created_at
 */

/**
 * @typedef {{ kind: 'proceed' }
 *   | { kind: 'in_progress' }
 *   | { kind: 'mismatch' }
 *   | { kind: 'replay', status: number, body: string }} BeginOutcome
 */

/**
 * @param {import('../db/index.js').Db} db
 * @param {{ keyName: string, key: string, requestHash: string, nowIso: string }} req
 * @returns {BeginOutcome}
 */
export function beginIdempotent(db, { keyName, key, requestHash, nowIso }) {
  return db.transaction(() => {
    const existing = /** @type {IdempotencyRecord | undefined} */ (
      db
        .prepare('SELECT * FROM idempotency_keys WHERE key_name = ? AND idempotency_key = ?')
        .get(keyName, key)
    );

    if (!existing) {
      db.prepare(
        `INSERT INTO idempotency_keys (key_name, idempotency_key, request_hash, created_at)
         VALUES (?, ?, ?, ?)`,
      ).run(keyName, key, requestHash, nowIso);
      return /** @type {const} */ ({ kind: 'proceed' });
    }

    if (existing.request_hash !== requestHash) return /** @type {const} */ ({ kind: 'mismatch' });

    if (existing.status === 'completed') {
      return /** @type {const} */ ({
        kind: 'replay',
        status: /** @type {number} */ (existing.response_status),
        body: existing.response_body ?? '',
      });
    }

    const stale = fromIso(existing.created_at) + STALE_MS <= fromIso(nowIso);
    if (!stale) return /** @type {const} */ ({ kind: 'in_progress' });

    db.prepare(
      `UPDATE idempotency_keys SET created_at = ? WHERE key_name = ? AND idempotency_key = ?`,
    ).run(nowIso, keyName, key);
    return /** @type {const} */ ({ kind: 'proceed' });
  })();
}

/**
 * @param {import('../db/index.js').Db} db
 * @param {{ keyName: string, key: string, status: number, body: string }} result
 */
export function completeIdempotent(db, { keyName, key, status, body }) {
  db.prepare(
    `UPDATE idempotency_keys SET status = 'completed', response_status = ?, response_body = ?
     WHERE key_name = ? AND idempotency_key = ?`,
  ).run(status, body, keyName, key);
}

/**
 * @param {import('../db/index.js').Db} db
 * @param {string} nowIso
 * @returns {number} rows removed
 */
export function purgeIdempotencyKeys(db, nowIso) {
  const cutoff = toIso(fromIso(nowIso) - RETENTION_MS);
  return db.prepare('DELETE FROM idempotency_keys WHERE created_at < ?').run(cutoff).changes;
}
