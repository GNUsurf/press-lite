import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { openDatabase } from '../src/db/index.js';
import { seedIfEmpty } from '../src/content/seed.js';
import { buildSite } from '../src/build/site.js';
import { sourceFromDb } from '../src/build/source.js';
import { listAssets } from '../src/services/assets.js';
import { listAudit } from '../src/services/audit.js';
import { getSiteCopy } from '../src/services/site-copy.js';
import { site } from '../site.config.js';
import {
  tmpDir,
  fakeClock,
  fixtureSource,
  emptyDist,
  FIXTURE_POSTS,
  FIXTURE_IMAGES,
  PUBLIC_DIR,
} from './helpers.js';

/** A file-backed DB (assets are written next to it) seeded from the fixtures. */
function seededDb() {
  const dataDir = tmpDir();
  const db = openDatabase(dataDir);
  const clock = fakeClock();
  const counts = seedIfEmpty(db, {
    dataDir,
    postsDir: FIXTURE_POSTS,
    imagesDir: FIXTURE_IMAGES,
    clock,
  });
  return { db, dataDir, clock, counts };
}

test('first boot imports posts, assets and site copy; second boot imports nothing', () => {
  const { db, dataDir, counts } = seededDb();
  assert.deepEqual(counts, { posts: 3, assets: 1, siteCopy: 1 });

  const [asset] = listAssets(db);
  assert.equal(asset.ext, 'png');
  assert.deepEqual([asset.width, asset.height], [64, 36]);
  assert.equal(asset.created_by, 'seed');
  assert.ok(fs.existsSync(path.join(dataDir, 'assets', `${asset.id}.png`)));

  const statuses = db
    .prepare('SELECT slug, status FROM posts ORDER BY slug')
    .all()
    .map((r) => /** @type {any} */ (r));
  assert.deepEqual(statuses, [
    { slug: 'draft-post-hidden', status: 'draft' },
    { slug: 'good-post-with-cover', status: 'published' },
    { slug: 'raw-html-is-escaped', status: 'published' },
  ]);
  assert.equal(getSiteCopy(db)?.version, 1);
  assert.deepEqual(getSiteCopy(db)?.data, site);

  const audit = listAudit(db);
  assert.ok(audit.length >= 7, `expected audit rows, got ${audit.length}`);
  assert.ok(audit.every((row) => row.key_name === 'seed'));
  assert.equal(
    /** @type {any} */ (db.prepare('SELECT COUNT(*) n FROM outbox').get()).n,
    0,
    'seeding emits no webhook events',
  );

  const again = seedIfEmpty(db, { dataDir, postsDir: FIXTURE_POSTS, imagesDir: FIXTURE_IMAGES });
  assert.deepEqual(again, { posts: 0, assets: 0, siteCopy: 0 });
  assert.equal(/** @type {any} */ (db.prepare('SELECT COUNT(*) n FROM posts').get()).n, 3);
});

test('a build from the database matches a build from the files', () => {
  const { db, dataDir } = seededDb();
  const builtAt = '2026-04-01T12:00:00.000Z';

  const fromFiles = emptyDist();
  buildSite({
    siteUrl: 'https://example.test',
    source: fixtureSource(),
    distDir: fromFiles,
    publicDir: PUBLIC_DIR,
    builtAt,
  });
  const fromDb = emptyDist();
  const result = buildSite({
    siteUrl: 'https://example.test',
    source: sourceFromDb(db, dataDir),
    distDir: fromDb,
    publicDir: PUBLIC_DIR,
    builtAt,
  });

  assert.deepEqual(
    result.pages,
    JSON.parse(fs.readFileSync(path.join(fromFiles, 'build.json'), 'utf8')).pages,
  );
  const read = (/** @type {string} */ dir, /** @type {string} */ f) =>
    fs.readFileSync(path.join(dir, f), 'utf8');
  // The only difference is the cover image URL (asset uuid vs seed file name).
  const [asset] = listAssets(db);
  for (const f of [
    'index.html',
    'blog/index.html',
    'blog/raw-html-is-escaped.html',
    'blog/good-post-with-cover.html',
    'sitemap.xml',
    'feed.xml',
  ]) {
    assert.equal(
      read(fromDb, f).replaceAll(`/images/${asset.id}.png`, '/images/cover.png'),
      read(fromFiles, f),
      `${f} differs`,
    );
  }
  assert.ok(
    !fs.existsSync(path.join(fromDb, 'images')),
    'DB builds serve images from the data dir',
  );
});
