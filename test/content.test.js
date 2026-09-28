import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadPosts,
  loadPost,
  parseFrontmatter,
  validateFrontmatter,
} from '../src/content/posts.js';
import { validateSiteCopy } from '../src/content/site-schema.js';
import { site } from '../site.config.js';
import { checkContent } from '../scripts/check-content.js';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const postsDir = path.join(FIXTURES, 'content/posts');
const imagesDir = path.join(FIXTURES, 'content/images');
const badDir = path.join(FIXTURES, 'bad-posts');

test('loads fixture posts newest first, skipping drafts, with cover dimensions', () => {
  const posts = loadPosts({ postsDir, imagesDir });
  assert.deepEqual(
    posts.map((p) => p.slug),
    ['good-post-with-cover', 'raw-html-is-escaped'],
  );
  assert.deepEqual(posts[0].coverSize, { width: 64, height: 36, type: 'png' });
  assert.equal(posts[0].coverUrl, '/images/cover.png');
  assert.equal(posts[1].coverUrl, null);
  assert.equal(loadPosts({ postsDir, imagesDir, includeDrafts: true }).length, 3);
});

test('raw <script>, <img onerror> and javascript: links do not survive rendering', () => {
  const post = loadPost(path.join(postsDir, 'raw-html-is-escaped.md'), { imagesDir });
  assert.ok(!post.html.includes('<script>'), 'script tag rendered');
  assert.ok(post.html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!post.html.includes('<img'), 'img tag rendered');
  assert.ok(post.html.includes('&lt;img src=x onerror=alert(2)&gt;'));
  // markdown-it refuses the link, so it stays literal (escaped) text, never an href.
  assert.ok(!post.html.includes('href="javascript:'), 'javascript: href rendered');
});

test('frontmatter validation reports every problem', () => {
  const { data } = parseFrontmatter(
    `---\ntitle: Short\ndescription: too short\ndate: 2026-13-01\nslug: Bad_Slug\ntags: []\ncover: images/missing.png\nextra: nope\n---\nbody`,
  );
  const errors = validateFrontmatter(data, { imagesDir });
  for (const field of ['title', 'description', 'date', 'slug', 'tags', 'cover', 'extra']) {
    assert.ok(
      errors.some((e) => e.startsWith(`${field}:`)),
      `expected an error for ${field}; got ${errors.join(' | ')}`,
    );
  }
  assert.throws(() => parseFrontmatter('no frontmatter'), /missing frontmatter/);
  assert.throws(() => loadPosts({ postsDir: badDir, imagesDir }), /bad-frontmatter\.md/);
});

test('a valid post passes; an oversized body fails', () => {
  const { data } = parseFrontmatter(
    `---\ntitle: A perfectly fine title\ndescription: A description that is long enough to satisfy the fifty character minimum.\ndate: 2026-01-01\nslug: fine\ntags: [x]\nbrief_id: b-1\n---\n`,
  );
  assert.deepEqual(validateFrontmatter(data, { imagesDir }), []);
  assert.deepEqual(validateFrontmatter(data, { imagesDir, body: 'x'.repeat(70_000) }), [
    'body: over 64 KB',
  ]);
});

test('site.config.js satisfies the site-copy schema; bad copy is rejected with paths', () => {
  assert.deepEqual(validateSiteCopy(site), []);
  const bad = structuredClone(site);
  bad.hero.headline = 'x'.repeat(200);
  /** @type {any} */ (bad).bogus = 1;
  bad.nav = [];
  const problems = validateSiteCopy(bad);
  assert.ok(
    problems.some((p) => p.startsWith('$.hero.headline')),
    problems.join(' | '),
  );
  assert.ok(problems.some((p) => p.startsWith('$.bogus')));
  assert.ok(problems.some((p) => p.startsWith('$.nav')));
});

test('check-content passes the fixtures and the real content', () => {
  assert.deepEqual(checkContent({ postsDir, imagesDir, publicDir: 'public' }), []);
  assert.deepEqual(checkContent(), []);
});
