/**
 * The limits every piece of content must satisfy. Frontmatter validation
 * (seed files) and the API's JSON Schemas both import these, so a post that
 * passes one passes the other.
 */

export const TITLE = { min: 10, max: 70 };
export const DESCRIPTION = { min: 50, max: 160 };
export const TAGS = { min: 1, max: 5, tagMax: 40 };
export const BODY_MAX_BYTES = 64 * 1024;

export const SLUG_PATTERN = '^[a-z0-9]+(?:-[a-z0-9]+)*$';
export const SLUG = new RegExp(SLUG_PATTERN);
export const SLUG_MAX = 80;

export const DATE_PATTERN = '^\\d{4}-\\d{2}-\\d{2}$';
export const DATE = new RegExp(DATE_PATTERN);

export const MAX_IMAGE_BYTES = 300 * 1024;
/** Extension by detected type; the file's own extension is never trusted. */
export const IMAGE_EXT = /** @type {const} */ ({ png: 'png', jpeg: 'jpg', webp: 'webp' });
export const IMAGE_MIME = /** @type {const} */ ({
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
});
export const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];

/** @param {unknown} value */
export function isValidDate(value) {
  return typeof value === 'string' && DATE.test(value) && !Number.isNaN(Date.parse(value));
}

/** Today's date as YYYY-MM-DD (UTC). @param {number} nowMs */
export function dateOf(nowMs) {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/** @param {string} body */
export function bodyTooLarge(body) {
  return Buffer.byteLength(body, 'utf8') > BODY_MAX_BYTES;
}
