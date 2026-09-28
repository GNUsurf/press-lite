/**
 * Subscribers: newsletter and lead-magnet signups. The site never emails
 * them; n8n owns double opt-in and delivery.
 */
import { nowIso } from '../lib/time.js';
import { enqueueEvent } from './outbox.js';
import { dedupeHash, findDuplicate, isUniqueViolation } from './dedupe.js';

/** `newsletter` or `magnet:<kebab-slug>` */
export const LIST_PATTERN = '^(newsletter|magnet:[a-z0-9]+(?:-[a-z0-9]+)*)$';

/**
 * @typedef {object} Subscriber
 * @property {number} id
 * @property {string} created_at
 * @property {string} email
 * @property {string} list
 * @property {string | null} source
 * @property {string | null} form_id
 * @property {string} dedupe_hash
 */

/**
 * @param {import('../db/index.js').Db} db
 * @param {{ email: string, list: string, source?: string, formId?: string }} input
 * @param {import('../lib/time.js').Clock} [clock]
 * @returns {{ subscriber: Subscriber, created: boolean }}
 */
export function createSubscriber(db, input, clock) {
  const now = nowIso(clock);
  const formId = input.formId || null;
  const hash = dedupeHash(input.email, input.list);

  const insert = db.transaction(() => {
    const existing = /** @type {Subscriber | undefined} */ (
      findDuplicate(db, 'subscribers', { formId, hash, nowIso: now })
    );
    if (existing) return { subscriber: existing, created: false };

    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO subscribers (created_at, email, list, source, form_id, dedupe_hash)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(now, input.email, input.list, input.source || null, formId, hash);
    const subscriber = /** @type {Subscriber} */ (
      db.prepare('SELECT * FROM subscribers WHERE id = ?').get(lastInsertRowid)
    );
    enqueueEvent(db, 'subscriber.created', publicSubscriber(subscriber), now);
    return { subscriber, created: true };
  });

  try {
    return insert();
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const subscriber = /** @type {Subscriber} */ (
      findDuplicate(db, 'subscribers', { formId, hash, nowIso: now })
    );
    return { subscriber, created: false };
  }
}

/** @param {Subscriber} s */
export function publicSubscriber(s) {
  return { id: s.id, created_at: s.created_at, email: s.email, list: s.list, source: s.source };
}
