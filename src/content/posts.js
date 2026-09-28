/**
 * Seed posts: `content/posts/<slug>.md` with YAML frontmatter. On first boot
 * they are imported into the database (src/content/seed.js); afterwards the
 * DB owns them. `scripts/build.js` (image build time, no volume) and
 * `scripts/check-content.js` still read the files directly.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { renderMarkdown } from '../lib/markdown.js';
import { imageSize } from '../lib/image-size.js';
import {
  TITLE,
  DESCRIPTION,
  TAGS,
  SLUG,
  MAX_IMAGE_BYTES,
  IMAGE_EXTENSIONS,
  isValidDate,
  bodyTooLarge,
} from './rules.js';

export const CONTENT_DIR = fileURLToPath(new URL('../../content/', import.meta.url));
export const POSTS_DIR = path.join(CONTENT_DIR, 'posts');
export const IMAGES_DIR = path.join(CONTENT_DIR, 'images');
export { MAX_IMAGE_BYTES, IMAGE_EXTENSIONS };

/**
 * @typedef {object} Frontmatter
 * @property {string} title
 * @property {string} description
 * @property {string} date          YYYY-MM-DD
 * @property {string} slug
 * @property {string[]} tags
 * @property {string} [brief_id]
 * @property {string} [cover]       images/<file>
 * @property {boolean} draft
 */

/**
 * What the templates render. Built from a seed file or from a DB row.
 * @typedef {object} Post
 * @property {string} title
 * @property {string} description
 * @property {string} date
 * @property {string} slug
 * @property {string[]} tags
 * @property {boolean} draft
 * @property {string} markdown
 * @property {string} html            rendered, sanitized Markdown
 * @property {string | null} coverUrl  public path, e.g. /images/<id>.png
 * @property {{ width: number, height: number } | null} coverSize
 * @property {string} [brief_id]
 * @property {string} [cover]         seed files only: images/<file>
 * @property {string} [file]          seed files only
 */

/**
 * Split `---\nyaml\n---\nbody`. Throws when the frontmatter block is missing.
 * @param {string} source
 * @returns {{ data: Record<string, unknown>, body: string }}
 */
export function parseFrontmatter(source) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(source);
  if (!match) throw new Error('missing frontmatter block');
  const data = YAML.parse(match[1]) ?? {};
  if (typeof data !== 'object' || Array.isArray(data)) throw new Error('frontmatter must be a map');
  return { data, body: match[2] };
}

/**
 * Validate frontmatter against the rules. Returns a list of problems; empty
 * means valid.
 * @param {Record<string, unknown>} data
 * @param {{ file?: string, imagesDir?: string, body?: string }} [options]
 * @returns {string[]}
 */
export function validateFrontmatter(data, { file, imagesDir = IMAGES_DIR, body } = {}) {
  /** @type {string[]} */
  const errors = [];
  const str = (
    /** @type {string} */ key,
    /** @type {{ min: number, max: number }} */ { min, max },
  ) => {
    const v = data[key];
    if (typeof v !== 'string') return errors.push(`${key}: required string`);
    const len = v.trim().length;
    if (len < min || len > max) errors.push(`${key}: must be ${min}–${max} characters, got ${len}`);
  };

  str('title', TITLE);
  str('description', DESCRIPTION);

  if (!isValidDate(data.date)) errors.push('date: must be YYYY-MM-DD');

  if (typeof data.slug !== 'string' || !SLUG.test(data.slug)) {
    errors.push('slug: must be kebab-case');
  } else if (file && path.basename(file, '.md') !== data.slug) {
    errors.push(`slug: must match the file name (${path.basename(file)})`);
  }

  const tags = data.tags;
  if (!Array.isArray(tags) || tags.length < TAGS.min || tags.length > TAGS.max) {
    errors.push(`tags: must be a list of ${TAGS.min}–${TAGS.max} strings`);
  } else if (
    !tags.every((t) => typeof t === 'string' && t.trim().length > 0 && t.length <= TAGS.tagMax)
  ) {
    errors.push(`tags: each tag must be a non-empty string of at most ${TAGS.tagMax} characters`);
  }

  if (data.brief_id !== undefined && (typeof data.brief_id !== 'string' || !data.brief_id.trim())) {
    errors.push('brief_id: must be a non-empty string');
  }

  if (data.cover !== undefined) {
    const cover = data.cover;
    if (typeof cover !== 'string' || !/^images\/[a-z0-9._-]+$/i.test(cover)) {
      errors.push('cover: must be images/<file>');
    } else {
      const ext = path.extname(cover).toLowerCase();
      const abs = path.join(imagesDir, path.basename(cover));
      if (!IMAGE_EXTENSIONS.includes(ext)) {
        errors.push(`cover: must be one of ${IMAGE_EXTENSIONS.join(', ')}`);
      } else if (!fs.existsSync(abs)) errors.push(`cover: ${cover} does not exist`);
      else if (fs.statSync(abs).size > MAX_IMAGE_BYTES)
        errors.push(`cover: ${cover} is over 300 KB`);
      else if (!imageSize(abs)) errors.push(`cover: ${cover} is not a readable PNG/JPEG/WebP`);
    }
  }

  if (data.draft !== undefined && typeof data.draft !== 'boolean') {
    errors.push('draft: must be true or false');
  }
  if (body !== undefined && bodyTooLarge(body)) errors.push('body: over 64 KB');

  const known = new Set([
    'title',
    'description',
    'date',
    'slug',
    'tags',
    'brief_id',
    'cover',
    'draft',
  ]);
  for (const key of Object.keys(data)) if (!known.has(key)) errors.push(`${key}: unknown field`);

  return errors;
}

/**
 * @param {string} file absolute path to a .md file
 * @param {{ imagesDir?: string }} [options]
 * @returns {Post}
 */
export function loadPost(file, { imagesDir = IMAGES_DIR } = {}) {
  const { data, body } = parseFrontmatter(fs.readFileSync(file, 'utf8'));
  const errors = validateFrontmatter(data, { file, imagesDir, body });
  if (errors.length) throw new Error(`${path.basename(file)}:\n  ${errors.join('\n  ')}`);
  const fm = /** @type {Frontmatter} */ (data);
  const coverFile = fm.cover ? path.join(imagesDir, path.basename(fm.cover)) : null;
  return {
    title: fm.title.trim(),
    description: fm.description.trim(),
    date: fm.date,
    slug: fm.slug,
    tags: fm.tags.map((t) => t.trim()),
    brief_id: fm.brief_id,
    cover: fm.cover,
    draft: fm.draft === true,
    file,
    markdown: body,
    html: renderMarkdown(body),
    coverUrl: fm.cover ? `/images/${path.basename(fm.cover)}` : null,
    coverSize: coverFile ? imageSize(coverFile) : null,
  };
}

/**
 * Every seed post, newest first. Drafts are skipped unless asked for. Throws
 * on the first invalid post or a duplicate slug.
 * @param {{ postsDir?: string, imagesDir?: string, includeDrafts?: boolean }} [options]
 * @returns {Post[]}
 */
export function loadPosts({
  postsDir = POSTS_DIR,
  imagesDir = IMAGES_DIR,
  includeDrafts = false,
} = {}) {
  if (!fs.existsSync(postsDir)) return [];
  const files = fs
    .readdirSync(postsDir)
    .filter((f) => f.endsWith('.md'))
    .sort();
  const posts = files.map((f) => loadPost(path.join(postsDir, f), { imagesDir }));

  const seen = new Set();
  for (const post of posts) {
    if (seen.has(post.slug)) throw new Error(`duplicate slug: ${post.slug}`);
    seen.add(post.slug);
  }

  return sortPosts(posts.filter((p) => includeDrafts || !p.draft));
}

/** Newest first, then by slug. @param {Post[]} posts */
export function sortPosts(posts) {
  return [...posts].sort((a, b) =>
    a.date < b.date ? 1 : a.date > b.date ? -1 : a.slug.localeCompare(b.slug),
  );
}
