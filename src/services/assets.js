/**
 * Assets: images only (PNG, JPEG, WebP), verified by their header bytes,
 * capped at 300 KB, stored under `$DATA_DIR/assets/<id>.<ext>` and served
 * at `/images/<id>.<ext>` with immutable caching. Identical bytes map to the
 * same asset, so re-imports and duplicate uploads are free.
 */
import fs from 'node:fs';
import path from 'node:path';
import { sha256, uuid } from '../lib/crypto.js';
import { imageSizeOf } from '../lib/image-size.js';
import { nowIso } from '../lib/time.js';
import { MAX_IMAGE_BYTES, IMAGE_EXT, IMAGE_MIME } from '../content/rules.js';
import { audit } from './audit.js';

/**
 * @typedef {object} Asset
 * @property {string} id
 * @property {'png' | 'jpg' | 'webp'} ext
 * @property {string} mime
 * @property {number} bytes
 * @property {number} width
 * @property {number} height
 * @property {string} sha256
 * @property {string | null} filename
 * @property {string} created_at
 * @property {string} created_by
 */

export class AssetError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** @param {string} dataDir */
export function assetsDir(dataDir) {
  const dir = path.join(dataDir, 'assets');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** @param {Pick<Asset, 'id' | 'ext'>} asset */
export function assetUrl(asset) {
  return `/images/${asset.id}.${asset.ext}`;
}

/** @param {string} dataDir @param {Pick<Asset, 'id' | 'ext'>} asset */
export function assetPath(dataDir, asset) {
  return path.join(assetsDir(dataDir), `${asset.id}.${asset.ext}`);
}

/**
 * Validate bytes as an image and store them. Returns the existing asset when
 * the same bytes were stored before.
 * @param {import('../db/index.js').Db} db
 * @param {string} dataDir
 * @param {{ buffer: Buffer, filename?: string | null, createdBy: string }} input
 * @param {import('../lib/time.js').Clock} [clock]
 * @returns {{ asset: Asset, created: boolean }}
 */
export function importAssetBuffer(db, dataDir, { buffer, filename = null, createdBy }, clock) {
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new AssetError(
      'asset_too_large',
      `image is ${buffer.length} bytes; the limit is ${MAX_IMAGE_BYTES}`,
    );
  }
  const size = imageSizeOf(buffer);
  if (!size) throw new AssetError('asset_not_image', 'not a PNG, JPEG or WebP image');

  const hash = sha256(buffer);
  const existing = /** @type {Asset | undefined} */ (
    db.prepare('SELECT * FROM assets WHERE sha256 = ?').get(hash)
  );
  if (existing) return { asset: existing, created: false };

  const asset = /** @type {Asset} */ ({
    id: uuid(),
    ext: IMAGE_EXT[size.type],
    mime: IMAGE_MIME[size.type],
    bytes: buffer.length,
    width: size.width,
    height: size.height,
    sha256: hash,
    filename: filename ? path.basename(filename).slice(0, 200) : null,
    created_at: nowIso(clock),
    created_by: createdBy,
  });

  fs.writeFileSync(assetPath(dataDir, asset), buffer);
  db.transaction(() => {
    db.prepare(
      `INSERT INTO assets (id, ext, mime, bytes, width, height, sha256, filename, created_at, created_by)
       VALUES (@id, @ext, @mime, @bytes, @width, @height, @sha256, @filename, @created_at, @created_by)`,
    ).run(asset);
    audit(
      db,
      {
        keyName: createdBy,
        action: 'asset.import',
        targetType: 'asset',
        targetId: asset.id,
        detail: { filename: asset.filename, bytes: asset.bytes },
      },
      clock,
    );
  })();
  return { asset, created: true };
}

/**
 * @param {import('../db/index.js').Db} db
 * @param {string} dataDir
 * @param {string} file
 * @param {string} createdBy
 * @param {import('../lib/time.js').Clock} [clock]
 */
export function importAssetFile(db, dataDir, file, createdBy, clock) {
  return importAssetBuffer(
    db,
    dataDir,
    { buffer: fs.readFileSync(file), filename: path.basename(file), createdBy },
    clock,
  );
}

/**
 * @param {import('../db/index.js').Db} db
 * @param {string} id
 * @returns {Asset | undefined}
 */
export function getAsset(db, id) {
  return /** @type {Asset | undefined} */ (db.prepare('SELECT * FROM assets WHERE id = ?').get(id));
}

/** @param {import('../db/index.js').Db} db @returns {Asset[]} */
export function listAssets(db) {
  return /** @type {Asset[]} */ (
    db.prepare('SELECT * FROM assets ORDER BY created_at DESC, id').all()
  );
}

/** The API/webhook shape. @param {Asset} asset */
export function publicAsset(asset) {
  return {
    id: asset.id,
    url: assetUrl(asset),
    mime: asset.mime,
    bytes: asset.bytes,
    width: asset.width,
    height: asset.height,
    filename: asset.filename,
    created_at: asset.created_at,
  };
}
