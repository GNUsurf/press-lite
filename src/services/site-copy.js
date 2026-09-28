/**
 * Site copy: the `site.config.js` shape, stored as one versioned JSON
 * document. Templates read it from here after the first boot.
 */
import { nowIso } from '../lib/time.js';
import { validateSiteCopy } from '../content/site-schema.js';
import { audit } from './audit.js';

/** @typedef {import('../../site.config.js').SiteConfig} SiteConfig */

export class SiteCopyError extends Error {
  /** @param {string[]} problems */
  constructor(problems) {
    super(`site copy is invalid:\n  ${problems.join('\n  ')}`);
    this.code = 'invalid';
    this.problems = problems;
  }
}

/**
 * @param {import('../db/index.js').Db} db
 * @returns {{ version: number, data: SiteConfig, updated_at: string } | null}
 */
export function getSiteCopy(db) {
  const row = /** @type {{ version: number, data: string, updated_at: string } | undefined} */ (
    db.prepare('SELECT version, data, updated_at FROM site_copy WHERE id = 1').get()
  );
  return row
    ? { version: row.version, data: JSON.parse(row.data), updated_at: row.updated_at }
    : null;
}

/**
 * Replace the site copy with a new version. Throws `SiteCopyError` when the
 * document doesn't fit the schema.
 * @param {import('../db/index.js').Db} db
 * @param {unknown} data
 * @param {string} by
 * @param {import('../lib/time.js').Clock} [clock]
 * @returns {{ version: number }}
 */
export function setSiteCopy(db, data, by, clock) {
  const problems = validateSiteCopy(data);
  if (problems.length) throw new SiteCopyError(problems);
  const now = nowIso(clock);
  const json = JSON.stringify(data);

  return db.transaction(() => {
    const current = getSiteCopy(db);
    const version = (current?.version ?? 0) + 1;
    db.prepare(
      `INSERT INTO site_copy (id, version, data, updated_at) VALUES (1, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET version = excluded.version, data = excluded.data, updated_at = excluded.updated_at`,
    ).run(version, json, now);
    db.prepare(
      `INSERT INTO site_copy_versions (version, data, created_at, created_by) VALUES (?, ?, ?, ?)`,
    ).run(version, json, now, by);
    audit(
      db,
      { keyName: by, action: 'site.update', targetType: 'site', targetId: 1, version },
      clock,
    );
    return { version };
  })();
}

/**
 * @param {import('../db/index.js').Db} db
 * @param {number} version
 * @returns {SiteConfig | null}
 */
export function getSiteCopyVersion(db, version) {
  const row = /** @type {{ data: string } | undefined} */ (
    db.prepare('SELECT data FROM site_copy_versions WHERE version = ?').get(version)
  );
  return row ? JSON.parse(row.data) : null;
}
