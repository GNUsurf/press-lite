/**
 * Posts in the database. Every change is a new `post_versions` row; the post
 * row points at the head (latest) version and, when published, the live one.
 * Nothing here talks HTTP; the routes map outcomes to status codes.
 */
import { randomSecret } from '../lib/crypto.js';
import { nowIso } from '../lib/time.js';
import { SLUG, bodyTooLarge, dateOf, isValidDate } from '../content/rules.js';
import { audit } from './audit.js';
import { enqueueEvent } from './outbox.js';
import { getAsset } from './assets.js';

export const POST_STATUSES = /** @type {const} */ ([
  'draft',
  'published',
  'unpublished',
  'deleted',
]);

/**
 * @typedef {object} PostRow
 * @property {number} id
 * @property {string} slug
 * @property {typeof POST_STATUSES[number]} status
 * @property {number} head_version
 * @property {number | null} live_version
 * @property {string} preview_token
 * @property {string} created_at
 * @property {string} updated_at
 * @property {string | null} published_at
 */

/**
 * @typedef {object} PostVersionRow
 * @property {number} id
 * @property {number} post_id
 * @property {number} version
 * @property {string} title
 * @property {string} description
 * @property {string} body
 * @property {string} tags            JSON array
 * @property {string | null} cover_asset_id
 * @property {string} date
 * @property {string} created_at
 * @property {string} created_by
 */

/**
 * @typedef {object} PostInput
 * @property {string} slug
 * @property {string} title
 * @property {string} description
 * @property {string} body
 * @property {string[]} tags
 * @property {string} [date]         YYYY-MM-DD; defaults to today
 * @property {string | null} [coverAssetId]
 */

/** @typedef {Partial<PostInput>} PostPatch */

export class PostError extends Error {
  /**
   * @param {'not_found' | 'slug_conflict' | 'slug_immutable' | 'version_mismatch' | 'invalid' | 'bad_state'} code
   * @param {string} message
   * @param {Record<string, unknown>} [detail]
   */
  constructor(code, message, detail = {}) {
    super(message);
    this.code = code;
    this.detail = detail;
  }
}

/**
 * @typedef {object} PostOptions
 * @property {import('../lib/time.js').Clock} [clock]
 * @property {string} [siteUrl]        for event payload URLs
 * @property {boolean} [emitEvent]     default true; the seed import turns it off
 * @property {number} [ifVersion]      If-Match on the head version
 */

/**
 * Create a draft at version 1.
 * @param {import('../db/index.js').Db} db
 * @param {PostInput} input
 * @param {string} by  API key name
 * @param {PostOptions} [options]
 * @returns {PostDetail}
 */
export function createPost(db, input, by, { clock } = {}) {
  const now = nowIso(clock);
  const content = checkContent(db, input, dateOf(Date.parse(now)));
  if (!content.slug || !SLUG.test(content.slug))
    throw new PostError('invalid', 'slug: must be kebab-case');

  return db.transaction(() => {
    const conflict = findBySlug(db, content.slug);
    if (conflict)
      throw new PostError('slug_conflict', `slug "${content.slug}" is taken`, { id: conflict.id });

    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO posts (slug, status, head_version, preview_token, created_at, updated_at)
         VALUES (?, 'draft', 1, ?, ?, ?)`,
      )
      .run(content.slug, randomSecret(), now, now);
    const id = Number(lastInsertRowid);
    insertVersion(db, id, 1, content, by, now);
    audit(
      db,
      {
        keyName: by,
        action: 'post.create',
        targetType: 'post',
        targetId: id,
        version: 1,
        detail: { slug: content.slug },
      },
      clock,
    );
    return /** @type {PostDetail} */ (getPost(db, id));
  })();
}

/**
 * Edit the head version: a new version row, head pointer moves. The live
 * page is untouched until publish.
 * @param {import('../db/index.js').Db} db
 * @param {number} id
 * @param {PostPatch} patch
 * @param {string} by
 * @param {PostOptions} [options]
 * @returns {PostDetail}
 */
export function updatePost(db, id, patch, by, { clock, ifVersion } = {}) {
  const now = nowIso(clock);
  return db.transaction(() => {
    const current = requireLive(db, id);
    if (ifVersion !== undefined && ifVersion !== current.post.head_version) {
      throw new PostError('version_mismatch', `head version is ${current.post.head_version}`, {
        version: current.post.head_version,
      });
    }
    const merged = { ...versionToInput(current.head), ...stripUndefined(patch) };
    const content = checkContent(db, merged, current.head.date);

    if (content.slug !== current.post.slug) {
      if (!SLUG.test(content.slug)) throw new PostError('invalid', 'slug: must be kebab-case');
      if (current.post.published_at) {
        throw new PostError(
          'slug_immutable',
          'the slug of a post that has been published cannot change',
        );
      }
      const conflict = findBySlug(db, content.slug);
      if (conflict)
        throw new PostError('slug_conflict', `slug "${content.slug}" is taken`, {
          id: conflict.id,
        });
    }

    const version = current.post.head_version + 1;
    insertVersion(db, id, version, content, by, now);
    db.prepare(`UPDATE posts SET slug = ?, head_version = ?, updated_at = ? WHERE id = ?`).run(
      content.slug,
      version,
      now,
      id,
    );
    audit(
      db,
      {
        keyName: by,
        action: 'post.update',
        targetType: 'post',
        targetId: id,
        version,
        detail: { slug: content.slug },
      },
      clock,
    );
    return /** @type {PostDetail} */ (getPost(db, id));
  })();
}

/**
 * Make the head version live.
 * @param {import('../db/index.js').Db} db
 * @param {number} id
 * @param {string} by
 * @param {PostOptions} [options]
 * @returns {PostDetail}
 */
export function publishPost(db, id, by, { clock, siteUrl = '', emitEvent = true } = {}) {
  const now = nowIso(clock);
  return db.transaction(() => {
    const { post } = requireLive(db, id);
    db.prepare(
      `UPDATE posts SET status = 'published', live_version = head_version, updated_at = ?,
         published_at = COALESCE(published_at, ?) WHERE id = ?`,
    ).run(now, now, id);
    db.prepare('DELETE FROM redirects WHERE from_path = ?').run(`/blog/${post.slug}`);
    audit(
      db,
      {
        keyName: by,
        action: 'post.publish',
        targetType: 'post',
        targetId: id,
        version: post.head_version,
        detail: { slug: post.slug },
      },
      clock,
    );
    if (emitEvent) {
      enqueueEvent(db, 'post.published', eventPayload(post, post.head_version, siteUrl), now);
    }
    return /** @type {PostDetail} */ (getPost(db, id));
  })();
}

/**
 * Take the page off the site; the post and its versions stay.
 * @param {import('../db/index.js').Db} db
 * @param {number} id
 * @param {string} by
 * @param {PostOptions} [options]
 * @returns {PostDetail}
 */
export function unpublishPost(db, id, by, { clock, siteUrl = '', emitEvent = true } = {}) {
  const now = nowIso(clock);
  return db.transaction(() => {
    const { post } = requireLive(db, id);
    if (post.status !== 'published') throw new PostError('bad_state', 'post is not published');
    db.prepare(
      `UPDATE posts SET status = 'unpublished', live_version = NULL, updated_at = ? WHERE id = ?`,
    ).run(now, id);
    audit(
      db,
      {
        keyName: by,
        action: 'post.unpublish',
        targetType: 'post',
        targetId: id,
        version: post.live_version,
        detail: { slug: post.slug },
      },
      clock,
    );
    if (emitEvent)
      enqueueEvent(db, 'post.unpublished', eventPayload(post, post.live_version, siteUrl), now);
    return /** @type {PostDetail} */ (getPost(db, id));
  })();
}

/**
 * Soft delete: status `deleted`, page gone, `/blog/<slug>` redirects to
 * `/blog`. Versions and audit rows stay.
 * @param {import('../db/index.js').Db} db
 * @param {number} id
 * @param {string} by
 * @param {PostOptions} [options]
 */
export function deletePost(db, id, by, { clock, siteUrl = '', emitEvent = true } = {}) {
  const now = nowIso(clock);
  return db.transaction(() => {
    const { post } = requireLive(db, id);
    const wasLive = post.status === 'published';
    db.prepare(
      `UPDATE posts SET status = 'deleted', live_version = NULL, updated_at = ? WHERE id = ?`,
    ).run(now, id);
    if (post.published_at) {
      db.prepare(
        `INSERT OR REPLACE INTO redirects (from_path, to_path, created_at) VALUES (?, '/blog', ?)`,
      ).run(`/blog/${post.slug}`, now);
    }
    audit(
      db,
      {
        keyName: by,
        action: 'post.delete',
        targetType: 'post',
        targetId: id,
        version: post.head_version,
        detail: { slug: post.slug },
      },
      clock,
    );
    if (wasLive && emitEvent) {
      enqueueEvent(
        db,
        'post.unpublished',
        { ...eventPayload(post, post.live_version, siteUrl), deleted: true },
        now,
      );
    }
  })();
}

/**
 * Copy an earlier version's content into a new head version; if the post is
 * published, it goes live at once.
 * @param {import('../db/index.js').Db} db
 * @param {number} id
 * @param {number} version
 * @param {string} by
 * @param {PostOptions} [options]
 * @returns {PostDetail}
 */
export function revertPost(db, id, version, by, { clock, siteUrl = '', emitEvent = true } = {}) {
  const now = nowIso(clock);
  return db.transaction(() => {
    const { post } = requireLive(db, id);
    const target = getPostVersion(db, id, version);
    if (!target) throw new PostError('not_found', `version ${version} does not exist`);
    const next = post.head_version + 1;
    insertVersion(db, id, next, checkContent(db, versionToInput(target), target.date), by, now);
    const live = post.status === 'published';
    db.prepare(
      `UPDATE posts SET head_version = ?, live_version = CASE WHEN ? THEN ? ELSE live_version END, updated_at = ? WHERE id = ?`,
    ).run(next, live ? 1 : 0, next, now, id);
    audit(
      db,
      {
        keyName: by,
        action: 'post.revert',
        targetType: 'post',
        targetId: id,
        version: next,
        detail: { slug: post.slug, from: version },
      },
      clock,
    );
    if (live && emitEvent)
      enqueueEvent(db, 'post.published', eventPayload(post, next, siteUrl), now);
    return /** @type {PostDetail} */ (getPost(db, id));
  })();
}

/**
 * @typedef {{ post: PostRow, head: PostVersionRow, live: PostVersionRow | null }} PostDetail
 */

/**
 * @param {import('../db/index.js').Db} db
 * @param {number} id
 * @returns {PostDetail | undefined}
 */
export function getPost(db, id) {
  const post = /** @type {PostRow | undefined} */ (
    db.prepare('SELECT * FROM posts WHERE id = ?').get(id)
  );
  if (!post) return undefined;
  return detail(db, post);
}

/**
 * @param {import('../db/index.js').Db} db
 * @param {string} token
 * @returns {PostDetail | undefined}
 */
export function getPostByPreviewToken(db, token) {
  const post = /** @type {PostRow | undefined} */ (
    db.prepare(`SELECT * FROM posts WHERE preview_token = ? AND status != 'deleted'`).get(token)
  );
  return post && detail(db, post);
}

/**
 * @param {import('../db/index.js').Db} db
 * @param {number} id
 * @param {number} version
 * @returns {PostVersionRow | undefined}
 */
export function getPostVersion(db, id, version) {
  return /** @type {PostVersionRow | undefined} */ (
    db.prepare('SELECT * FROM post_versions WHERE post_id = ? AND version = ?').get(id, version)
  );
}

/**
 * Versions without bodies, newest first.
 * @param {import('../db/index.js').Db} db
 * @param {number} id
 */
export function listVersions(db, id) {
  return /** @type {Omit<PostVersionRow, 'body'>[]} */ (
    db
      .prepare(
        `SELECT id, post_id, version, title, description, tags, cover_asset_id, date, created_at, created_by
         FROM post_versions WHERE post_id = ? ORDER BY version DESC`,
      )
      .all(id)
  );
}

/**
 * Keyset pagination over (updated_at, id), newest first.
 * @param {import('../db/index.js').Db} db
 * @param {{ status?: typeof POST_STATUSES[number], cursor?: string, limit: number }} page
 * @returns {{ items: ReturnType<typeof publicPost>[], next_cursor: string | null }}
 */
export function listPosts(db, { status, cursor, limit }) {
  const after = decodeCursor(cursor);
  const rows = /** @type {PostRow[]} */ (
    db
      .prepare(
        `SELECT * FROM posts
         WHERE (? IS NULL OR status = ?) AND status != 'deleted'
           AND (? IS NULL OR (updated_at, id) < (?, ?))
         ORDER BY updated_at DESC, id DESC LIMIT ?`,
      )
      .all(
        status ?? null,
        status ?? null,
        after?.updatedAt ?? null,
        after?.updatedAt ?? '',
        after?.id ?? 0,
        limit + 1,
      )
  );
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit).map((post) => publicPost(detail(db, post)));
  const last = rows[Math.min(limit, rows.length) - 1];
  return { items, next_cursor: hasMore && last ? encodeCursor(last) : null };
}

/**
 * Published posts with their live version, for rendering.
 * @param {import('../db/index.js').Db} db
 * @returns {{ post: PostRow, live: PostVersionRow }[]}
 */
export function listLivePosts(db) {
  const rows = /** @type {(PostRow & { v_id: number })[]} */ (
    db
      .prepare(
        `SELECT p.*, v.id AS v_id FROM posts p JOIN post_versions v ON v.post_id = p.id AND v.version = p.live_version WHERE p.status = 'published'`,
      )
      .all()
  );
  return rows.map((row) => ({
    post: row,
    live: /** @type {PostVersionRow} */ (
      db.prepare('SELECT * FROM post_versions WHERE id = ?').get(row.v_id)
    ),
  }));
}

/** The API shape: head content plus status and pointers. @param {PostDetail} d */
export function publicPost({ post, head, live }) {
  return {
    id: post.id,
    slug: post.slug,
    status: post.status,
    head_version: post.head_version,
    live_version: post.live_version,
    created_at: post.created_at,
    updated_at: post.updated_at,
    published_at: post.published_at,
    preview_path: `/preview/${post.preview_token}`,
    url: post.status === 'published' ? `/blog/${post.slug}` : null,
    title: head.title,
    description: head.description,
    body: head.body,
    tags: /** @type {string[]} */ (JSON.parse(head.tags)),
    cover_asset_id: head.cover_asset_id,
    date: head.date,
    live_differs: live ? live.id !== head.id : false,
  };
}

/** @param {PostVersionRow} v @returns {PostInput} */
export function versionToInput(v) {
  return {
    slug: '',
    title: v.title,
    description: v.description,
    body: v.body,
    tags: JSON.parse(v.tags),
    date: v.date,
    coverAssetId: v.cover_asset_id,
  };
}

// --- internals --------------------------------------------------------------

/**
 * Normalise and range-check content. Routes validate shape with JSON Schema;
 * this is the last line for callers that bypass HTTP (seed, tests).
 * @param {import('../db/index.js').Db} db
 * @param {PostInput | (PostPatch & { slug?: string })} input
 * @param {string} defaultDate
 * @returns {PostInput & { date: string, coverAssetId: string | null }}
 */
function checkContent(db, input, defaultDate) {
  const date = input.date ?? defaultDate;
  if (!isValidDate(date)) throw new PostError('invalid', 'date: must be YYYY-MM-DD');
  const body = input.body ?? '';
  if (bodyTooLarge(body)) throw new PostError('invalid', 'body: over 64 KB');
  const coverAssetId = input.coverAssetId ?? null;
  if (coverAssetId && !getAsset(db, coverAssetId))
    throw new PostError('invalid', `cover_asset_id: unknown asset ${coverAssetId}`);
  return {
    slug: (input.slug ?? '').trim(),
    title: (input.title ?? '').trim(),
    description: (input.description ?? '').trim(),
    body,
    tags: (input.tags ?? []).map((t) => t.trim()),
    date,
    coverAssetId,
  };
}

/** @param {Record<string, unknown>} obj */
function stripUndefined(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

/**
 * @param {import('../db/index.js').Db} db @param {number} id @param {number} version
 * @param {ReturnType<typeof checkContent>} c @param {string} by @param {string} now
 */
function insertVersion(db, id, version, c, by, now) {
  db.prepare(
    `INSERT INTO post_versions (post_id, version, title, description, body, tags, cover_asset_id, date, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    version,
    c.title,
    c.description,
    c.body,
    JSON.stringify(c.tags),
    c.coverAssetId,
    c.date,
    now,
    by,
  );
}

/** @param {import('../db/index.js').Db} db @param {PostRow} post @returns {PostDetail} */
function detail(db, post) {
  const head = /** @type {PostVersionRow} */ (getPostVersion(db, post.id, post.head_version));
  const live = post.live_version ? (getPostVersion(db, post.id, post.live_version) ?? null) : null;
  return { post, head, live };
}

/** A post that exists and isn't deleted. @param {import('../db/index.js').Db} db @param {number} id */
function requireLive(db, id) {
  const d = getPost(db, id);
  if (!d || d.post.status === 'deleted') throw new PostError('not_found', `post ${id} not found`);
  return d;
}

/** @param {import('../db/index.js').Db} db @param {string} slug */
function findBySlug(db, slug) {
  return /** @type {{ id: number } | undefined} */ (
    db.prepare('SELECT id FROM posts WHERE slug = ?').get(slug)
  );
}

/** @param {PostRow} post @param {number | null} version @param {string} siteUrl */
function eventPayload(post, version, siteUrl) {
  return { id: post.id, slug: post.slug, version, url: `${siteUrl}/blog/${post.slug}` };
}

/** @param {PostRow} row */
function encodeCursor(row) {
  return Buffer.from(JSON.stringify([row.updated_at, row.id])).toString('base64url');
}

/** @param {string | undefined} cursor */
function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    const [updatedAt, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (typeof updatedAt === 'string' && Number.isInteger(id)) return { updatedAt, id };
  } catch {
    // fall through
  }
  throw Object.assign(new Error('cursor is not valid'), { statusCode: 400, code: 'bad_cursor' });
}
