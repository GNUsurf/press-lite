import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildSite, builtFor } from '../src/build/site.js';
import { checkLinks } from '../scripts/check-links.js';
import { imageSize } from '../src/lib/image-size.js';
import { site } from '../site.config.js';
import { tmpDir, fixtureSource, emptyDist, PUBLIC_DIR as PUBLIC } from './helpers.js';

/** Build into a temp dist using the fixture posts and the real public/ dir. */
function build(/** @type {Partial<Parameters<typeof buildSite>[0]>} */ overrides = {}) {
  const distDir = emptyDist();
  const result = buildSite({
    siteUrl: 'https://example.test',
    source: fixtureSource(),
    distDir,
    publicDir: PUBLIC,
    builtAt: '2026-04-01T12:00:00.000Z',
    ...overrides,
  });
  const read = (/** @type {string} */ f) => fs.readFileSync(path.join(distDir, f), 'utf8');
  return { distDir, result, read };
}

test('renders every page, posts, feeds and hashed assets', async () => {
  const { distDir, result } = build();
  assert.deepEqual(result.pages, [
    '/',
    '/services',
    '/work',
    '/blog',
    '/about',
    '/contact',
    '/privacy',
    '/404',
    '/blog/good-post-with-cover',
    '/blog/raw-html-is-escaped',
  ]);
  for (const f of [
    'index.html',
    'services.html',
    'blog/index.html',
    'blog/good-post-with-cover.html',
    '404.html',
    'sitemap.xml',
    'robots.txt',
    'feed.xml',
    'favicon.svg',
    'og-default.png',
    'hero-poster.jpg',
    'images/cover.png',
    'build.json',
  ]) {
    assert.ok(fs.existsSync(path.join(distDir, f)), `missing ${f}`);
  }
  assert.ok(
    fs.readdirSync(path.join(distDir, 'assets')).some((f) => /^site\.[0-9a-f]{12}\.js$/.test(f)),
  );
  assert.equal(builtFor(distDir), 'https://example.test');
  assert.deepEqual(await checkLinks({ distDir }), []);
});

test('pages carry unique titles, canonical URLs, OG tags and JSON-LD', () => {
  const { read } = build();
  const home = read('index.html');
  assert.match(home, /<link rel="canonical" href="https:\/\/example\.test\/">/);
  assert.match(home, /"@type":"ProfessionalService"/);
  assert.match(
    home,
    /<meta property="og:image" content="https:\/\/example\.test\/og-default\.png">/,
  );
  const poster = imageSize(path.join(PUBLIC, 'hero-poster.jpg'));
  assert.match(
    home,
    new RegExp(
      `<img\\s+src="/hero-poster\\.jpg"\\s+alt=""\\s+width="${poster?.width}"\\s+height="${poster?.height}"`,
    ),
  );
  assert.equal(
    home.includes('<video'),
    fs.existsSync(path.join(PUBLIC, 'hero.mp4')),
    'video only when hero.mp4 exists',
  );
  assert.ok(!home.includes('<script>'), 'no inline scripts (CSP)');
  assert.match(home, /<script src="\/assets\/site\.[0-9a-f]{12}\.js" defer><\/script>/);

  const post = read('blog/good-post-with-cover.html');
  assert.ok(post.includes(`<title>A good post with a cover image — ${site.name}</title>`));
  assert.match(
    post,
    /<link rel="canonical" href="https:\/\/example\.test\/blog\/good-post-with-cover">/,
  );
  assert.match(post, /<meta property="og:type" content="article">/);
  assert.match(
    post,
    /<meta property="og:image" content="https:\/\/example\.test\/images\/cover\.png">/,
  );
  assert.match(post, /"@type":"BlogPosting"/);
  assert.match(post, /<img\s+src="\/images\/cover\.png"\s+alt=""\s+width="64"\s+height="36"/);

  const titles = [
    'index',
    'services',
    'work',
    'blog/index',
    'about',
    'contact',
    'privacy',
    '404',
  ].map((p) => /<title>([^<]+)<\/title>/.exec(read(`${p}.html`))?.[1]);
  assert.equal(new Set(titles).size, titles.length, 'titles are unique');
});

test('post with raw HTML renders escaped in the built page', () => {
  const { read } = build();
  const page = read('blog/raw-html-is-escaped.html');
  assert.ok(page.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!/<script>alert/.test(page));
  assert.ok(
    !page.includes('onerror=alert(2)>') || page.includes('&lt;img src=x onerror=alert(2)&gt;'),
  );
  assert.ok(!page.includes('href="javascript:'));
});

test('drafts stay out of the list, sitemap and feed; sitemap and feed are well-formed', () => {
  const { read } = build();
  const sitemap = read('sitemap.xml');
  const feed = read('feed.xml');
  const blog = read('blog/index.html');
  for (const doc of [sitemap, feed, blog]) assert.ok(!doc.includes('draft-post-hidden'));
  assert.match(
    sitemap,
    /<loc>https:\/\/example\.test\/blog\/good-post-with-cover<\/loc><lastmod>2026-02-01<\/lastmod>/,
  );
  assert.ok(!sitemap.includes('/404') && !sitemap.includes('/privacy'));
  assert.match(
    feed,
    /<guid isPermaLink="true">https:\/\/example\.test\/blog\/raw-html-is-escaped<\/guid>/,
  );
  assert.match(feed, /<pubDate>Sun, 01 Feb 2026 00:00:00 GMT<\/pubDate>/);
  assert.match(read('robots.txt'), /Sitemap: https:\/\/example\.test\/sitemap\.xml/);
  assert.match(read('robots.txt'), /Disallow: \/preview\//);
});

test('dev builds use unhashed asset names; a rebuild replaces stale output', () => {
  const { distDir, read } = build({ dev: true });
  assert.match(read('index.html'), /\/assets\/site\.css/);
  assert.match(read('index.html'), /\/assets\/site\.js/);
  fs.writeFileSync(path.join(distDir, 'stale.html'), 'old');
  buildSite({
    siteUrl: 'https://other.test/',
    source: fixtureSource(),
    distDir,
    publicDir: PUBLIC,
  });
  assert.ok(!fs.existsSync(path.join(distDir, 'stale.html')));
  assert.equal(builtFor(distDir), 'https://other.test');
  assert.match(read('index.html'), /href="https:\/\/other\.test\/"/);
});

test('refuses to build without the CSS', () => {
  assert.throws(
    () =>
      buildSite({
        siteUrl: 'https://x.test',
        source: fixtureSource(),
        distDir: tmpDir(),
        publicDir: PUBLIC,
      }),
    /make css/,
  );
});
