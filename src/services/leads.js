/**
 * Leads: rows from the contact form, read and updated by n8n over /api/v1.
 */
import { nowIso } from '../lib/time.js';
import { enqueueEvent } from './outbox.js';
import { dedupeHash, findDuplicate, isUniqueViolation } from './dedupe.js';

export const LEAD_STATUSES = /** @type {const} */ ([
  'new',
  'contacted',
  'qualified',
  'won',
  'lost',
]);

/**
 * @typedef {object} Lead
 * @property {number} id
 * @property {string} created_at
 * @property {string} updated_at
 * @property {number} version
 * @property {string} name
 * @property {string} email
 * @property {string | null} company
 * @property {string} message
 * @property {string | null} source
 * @property {typeof LEAD_STATUSES[number]} status
 * @property {string} tags       JSON array
 * @property {string} notes
 * @property {string | null} form_id
 * @property {string} dedupe_hash
 */

/**
 * @typedef {object} NewLead
 * @property {string} name
 * @property {string} email
 * @property {string} [company]
 * @property {string} message
 * @property {string} [source]
 * @property {string} [formId]
 */

/**
 * Insert a lead and its `lead.created` outbox row in one transaction, unless
 * it's a duplicate, in which case the existing row is returned.
 * @param {import('../db/index.js').Db} db
 * @param {NewLead} input
 * @param {import('../lib/time.js').Clock} [clock]
 * @returns {{ lead: Lead, created: boolean }}
 */
export function createLead(db, input, clock) {
  const now = nowIso(clock);
  const formId = input.formId || null;
  const hash = dedupeHash(input.email, input.message);

  const insert = db.transaction(() => {
    const existing = /** @type {Lead | undefined} */ (
      findDuplicate(db, 'leads', { formId, hash, nowIso: now })
    );
    if (existing) return { lead: existing, created: false };

    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO leads (created_at, updated_at, name, email, company, message, source, form_id, dedupe_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        now,
        now,
        input.name,
        input.email,
        input.company || null,
        input.message,
        input.source || null,
        formId,
        hash,
      );
    const lead = /** @type {Lead} */ (getLead(db, Number(lastInsertRowid)));
    enqueueEvent(db, 'lead.created', publicLead(lead), now);
    return { lead, created: true };
  });

  try {
    return insert();
  } catch (err) {
    // Two requests with the same form_id raced past the SELECT; the loser reads the winner.
    if (!isUniqueViolation(err)) throw err;
    const lead = /** @type {Lead} */ (findDuplicate(db, 'leads', { formId, hash, nowIso: now }));
    return { lead, created: false };
  }
}

/**
 * @param {import('../db/index.js').Db} db
 * @param {number} id
 * @returns {Lead | undefined}
 */
export function getLead(db, id) {
  return /** @type {Lead | undefined} */ (db.prepare('SELECT * FROM leads WHERE id = ?').get(id));
}

/**
 * Keyset pagination over (created_at, id).
 * @param {import('../db/index.js').Db} db
 * @param {{ cursor?: string, limit: number }} page
 * @returns {{ items: ReturnType<typeof publicLead>[], next_cursor: string | null }}
 */
export function listLeads(db, { cursor, limit }) {
  const after = decodeCursor(cursor);
  const rows = /** @type {Lead[]} */ (
    db
      .prepare(
        `SELECT * FROM leads WHERE (created_at, id) > (?, ?)
         ORDER BY created_at, id LIMIT ?`,
      )
      .all(after.createdAt, after.id, limit + 1)
  );
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items: items.map(publicLead),
    next_cursor: hasMore && last ? encodeCursor(last) : null,
  };
}

/**
 * @typedef {object} LeadPatch
 * @property {typeof LEAD_STATUSES[number]} [status]
 * @property {string[]} [tags]
 * @property {string} [notes]
 */

/**
 * @param {import('../db/index.js').Db} db
 * @param {number} id
 * @param {LeadPatch} patch
 * @param {{ ifVersion?: number, emitEvent?: boolean, clock?: import('../lib/time.js').Clock }} options
 *   `emitEvent` is true only for edits by a human; n8n's own PATCHes must not
 *   echo back to n8n as `lead.updated`.
 * @returns {{ ok: true, lead: Lead } | { ok: false, reason: 'not_found' | 'version_mismatch', lead?: Lead }}
 */
export function updateLead(db, id, patch, { ifVersion, emitEvent = false, clock } = {}) {
  return db.transaction(() => {
    const current = getLead(db, id);
    if (!current) return /** @type {const} */ ({ ok: false, reason: 'not_found' });
    if (ifVersion !== undefined && ifVersion !== current.version) {
      return /** @type {const} */ ({ ok: false, reason: 'version_mismatch', lead: current });
    }
    const now = nowIso(clock);
    db.prepare(
      `UPDATE leads SET status = ?, tags = ?, notes = ?, updated_at = ?, version = version + 1 WHERE id = ?`,
    ).run(
      patch.status ?? current.status,
      patch.tags ? JSON.stringify(patch.tags) : current.tags,
      patch.notes ?? current.notes,
      now,
      id,
    );
    const lead = /** @type {Lead} */ (getLead(db, id));
    if (emitEvent) enqueueEvent(db, 'lead.updated', publicLead(lead), now);
    return /** @type {const} */ ({ ok: true, lead });
  })();
}

/**
 * The API/webhook shape: tags parsed, internal columns dropped.
 * @param {Lead} lead
 */
export function publicLead(lead) {
  return {
    id: lead.id,
    created_at: lead.created_at,
    updated_at: lead.updated_at,
    version: lead.version,
    name: lead.name,
    email: lead.email,
    company: lead.company,
    message: lead.message,
    source: lead.source,
    status: lead.status,
    tags: /** @type {string[]} */ (JSON.parse(lead.tags)),
    notes: lead.notes,
  };
}

/** @param {Lead} lead */
function encodeCursor(lead) {
  return Buffer.from(JSON.stringify([lead.created_at, lead.id])).toString('base64url');
}

/** @param {string | undefined} cursor */
function decodeCursor(cursor) {
  if (!cursor) return { createdAt: '', id: 0 };
  try {
    const [createdAt, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (typeof createdAt === 'string' && Number.isInteger(id)) return { createdAt, id };
  } catch {
    // fall through
  }
  throw Object.assign(new Error('cursor is not valid'), { statusCode: 400, code: 'bad_cursor' });
}
