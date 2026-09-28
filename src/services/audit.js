/**
 * Audit log: one row per content write. Who (API key name), what, which
 * target and version. Never bodies, never PII.
 */
import { nowIso } from '../lib/time.js';

/**
 * @typedef {object} AuditEntry
 * @property {string} keyName
 * @property {string} action        e.g. post.create, post.publish, site.update, asset.import
 * @property {'post' | 'site' | 'asset'} targetType
 * @property {string | number} targetId
 * @property {number | null} [version]
 * @property {Record<string, unknown> | null} [detail]  small, e.g. { slug }
 */

/**
 * @param {import('../db/index.js').Db} db
 * @param {AuditEntry} entry
 * @param {import('../lib/time.js').Clock} [clock]
 */
export function audit(
  db,
  { keyName, action, targetType, targetId, version = null, detail = null },
  clock,
) {
  db.prepare(
    `INSERT INTO audit (at, key_name, action, target_type, target_id, version, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    nowIso(clock),
    keyName,
    action,
    targetType,
    String(targetId),
    version,
    detail ? JSON.stringify(detail) : null,
  );
}

/**
 * @typedef {object} AuditRow
 * @property {number} id
 * @property {string} at
 * @property {string} key_name
 * @property {string} action
 * @property {string} target_type
 * @property {string} target_id
 * @property {number | null} version
 * @property {string | null} detail
 */

/**
 * Newest first.
 * @param {import('../db/index.js').Db} db
 * @param {{ limit?: number, targetType?: string, targetId?: string | number }} [options]
 * @returns {AuditRow[]}
 */
export function listAudit(db, { limit = 100, targetType, targetId } = {}) {
  if (targetType && targetId !== undefined) {
    return /** @type {AuditRow[]} */ (
      db
        .prepare(
          `SELECT * FROM audit WHERE target_type = ? AND target_id = ? ORDER BY id DESC LIMIT ?`,
        )
        .all(targetType, String(targetId), limit)
    );
  }
  return /** @type {AuditRow[]} */ (
    db.prepare(`SELECT * FROM audit ORDER BY id DESC LIMIT ?`).all(limit)
  );
}
