/**
 * Outbox rows: how domain writes announce themselves to n8n. `enqueueEvent`
 * must be called inside the same transaction as the row it describes.
 * Delivery lives in src/worker/outbox.js.
 */
import { uuid } from '../lib/crypto.js';
import { HOUR, toIso, fromIso } from '../lib/time.js';

export const DEAD_AFTER_MS = 48 * HOUR;

/**
 * @typedef {'lead.created' | 'lead.updated' | 'subscriber.created'
 *   | 'post.published' | 'post.unpublished' | 'site.updated'} EventType
 */

/**
 * @typedef {object} OutboxRow
 * @property {number} id
 * @property {string} event_id
 * @property {EventType} event_type
 * @property {string} occurred_at
 * @property {string} payload
 * @property {string} created_at
 * @property {'pending' | 'delivered' | 'dead'} status
 * @property {number} attempts
 * @property {string} next_attempt_at
 * @property {string} dead_after
 * @property {string | null} lease_until
 * @property {string | null} delivered_at
 * @property {string | null} last_error
 */

/**
 * @param {import('../db/index.js').Db} db
 * @param {EventType} eventType
 * @param {Record<string, unknown>} data
 * @param {string} occurredAt ISO
 * @returns {string} event_id
 */
export function enqueueEvent(db, eventType, data, occurredAt) {
  const eventId = uuid();
  db.prepare(
    `INSERT INTO outbox (event_id, event_type, occurred_at, payload, created_at, next_attempt_at, dead_after)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    eventId,
    eventType,
    occurredAt,
    JSON.stringify(data),
    occurredAt,
    occurredAt,
    toIso(fromIso(occurredAt) + DEAD_AFTER_MS),
  );
  return eventId;
}

/**
 * Re-queue a dead row. Returns false when the id is unknown or not dead.
 * @param {import('../db/index.js').Db} db
 * @param {number} id
 * @param {string} nowIso
 */
export function retryDead(db, id, nowIso) {
  const result = db
    .prepare(
      `UPDATE outbox
       SET status = 'pending', next_attempt_at = ?, dead_after = ?, lease_until = NULL, last_error = NULL
       WHERE id = ? AND status = 'dead'`,
    )
    .run(nowIso, toIso(fromIso(nowIso) + DEAD_AFTER_MS), id);
  return result.changes === 1;
}

/**
 * @param {import('../db/index.js').Db} db
 * @param {'pending' | 'delivered' | 'dead'} status
 * @param {number} limit
 * @returns {Omit<OutboxRow, 'payload'>[]}
 */
export function listOutbox(db, status, limit) {
  return /** @type {Omit<OutboxRow, 'payload'>[]} */ (
    db
      .prepare(
        `SELECT id, event_id, event_type, occurred_at, created_at, status, attempts,
                next_attempt_at, dead_after, lease_until, delivered_at, last_error
         FROM outbox WHERE status = ? ORDER BY id DESC LIMIT ?`,
      )
      .all(status, limit)
  );
}

/**
 * Counts for /api/v1/status. No PII.
 * @param {import('../db/index.js').Db} db
 */
export function outboxStats(db) {
  const counts = /** @type {{status: string, n: number}[]} */ (
    db.prepare('SELECT status, COUNT(*) AS n FROM outbox GROUP BY status').all()
  );
  const byStatus = Object.fromEntries(counts.map((r) => [r.status, r.n]));
  const last = /** @type {{ t: string | null }} */ (
    db.prepare('SELECT MAX(delivered_at) AS t FROM outbox').get()
  );
  return {
    pending: byStatus.pending ?? 0,
    dead: byStatus.dead ?? 0,
    delivered: byStatus.delivered ?? 0,
    last_delivered_at: last.t,
  };
}
