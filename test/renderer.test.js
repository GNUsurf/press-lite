import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { openDatabase } from '../src/db/index.js';
import { seedIfEmpty } from '../src/content/seed.js';
import { createRenderer } from '../src/build/renderer.js';
import { builtFor } from '../src/build/site.js';
import { tmpDir, emptyDist, fakeLog, FIXTURE_POSTS, FIXTURE_IMAGES } from './helpers.js';

function setup() {
  const dataDir = tmpDir();
  const db = openDatabase(dataDir);
  seedIfEmpty(db, { dataDir, postsDir: FIXTURE_POSTS, imagesDir: FIXTURE_IMAGES });
  const distDir = emptyDist();
  const log = fakeLog();
  const renderer = createRenderer({
    db,
    env: { siteUrl: 'https://example.test', dataDir },
    log,
    distDir,
    delayMs: 20,
  });
  return { db, dataDir, distDir, log, renderer };
}

test('renderNow renders from the database and records the build', () => {
  const { distDir, renderer, log } = setup();
  const result = renderer.renderNow();
  assert.equal(result?.pages.length, 10);
  assert.equal(builtFor(distDir), 'https://example.test');
  assert.ok(fs.existsSync(path.join(distDir, 'blog/good-post-with-cover.html')));
  assert.equal(log.entries.at(-1)?.level, 'info');
});

test('schedule() debounces a burst into one render', async () => {
  const { distDir, renderer, log } = setup();
  for (let i = 0; i < 5; i++) renderer.schedule();
  await new Promise((r) => setTimeout(r, 80));
  const renders = log.entries.filter((e) => e.level === 'info');
  assert.equal(renders.length, 1);
  assert.ok(fs.existsSync(path.join(distDir, 'index.html')));
  renderer.stop();
});

test('a failed render is logged, not thrown, and redirects reload on render', () => {
  const { db, renderer, log } = setup();
  db.prepare(`INSERT INTO redirects (from_path, to_path) VALUES ('/blog/old', '/blog')`).run();
  assert.equal(
    renderer.redirectFor('/blog/old'),
    null,
    'map is loaded at creation, refreshed on render',
  );
  renderer.renderNow();
  assert.equal(renderer.redirectFor('/blog/old'), '/blog');
  assert.equal(renderer.redirectFor('/blog/other'), null);

  const broken = createRenderer({
    db,
    env: { siteUrl: 'https://example.test', dataDir: tmpDir() },
    log,
    distDir: tmpDir(), // no CSS → buildSite throws
  });
  assert.equal(broken.renderNow(), null);
  assert.equal(log.entries.at(-1)?.level, 'error');
});
