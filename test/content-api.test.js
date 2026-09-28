import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeApp, bearer, KEYS } from './helpers.js';
import { listAudit } from '../src/services/audit.js';

const draft = {
  slug: 'hello-world',
  title: 'Hello world, a first post',
  description: 'A description that is comfortably longer than fifty characters for the schema.',
  body: 'Plain paragraph.\n\n<script>alert(1)</script>\n\n[x](javascript:alert(2))',
  tags: ['intro'],
};

/**
 * @param {import('fastify').FastifyInstance} app
 * @param {string} key
 * @param {'POST' | 'PATCH' | 'DELETE' | 'GET'} method
 * @param {string} url
 * @param {object} [payload]
 * @param {Record<string, string>} [headers]
 */
function call(app, key, method, url, payload, headers = {}) {
  const idem = method === 'GET' ? {} : { 'idempotency-key': crypto.randomUUID() };
  return app.inject({
    method,
    url: `/api/v1${url}`,
    payload,
    headers: { ...bearer(key), ...idem, ...headers },
  });
}

const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

test('create a draft: 201, preview URL, script in body is escaped in the preview', async (t) => {
  const { app, close } = await makeApp({ render: true });
  t.after(close);
  const res = await call(app, KEYS.writer, 'POST', '/posts', draft);
  assert.equal(res.statusCode, 201, res.body);
  const post = res.json();
  assert.equal(post.status, 'draft');
  assert.equal(post.head_version, 1);
  assert.equal(post.live_version, null);
  assert.equal(post.url, null);
  assert.match(post.preview_url, /^https:\/\/example\.test\/preview\/[A-Za-z0-9_-]{40,}$/);
  assert.equal(res.headers.etag, '"1"');

  const preview = await app.inject({ method: 'GET', url: new URL(post.preview_url).pathname });
  assert.equal(preview.statusCode, 200);
  assert.equal(preview.headers['x-robots-tag'], 'noindex, nofollow');
  assert.equal(preview.headers['cache-control'], 'no-store');
  assert.ok(preview.body.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!/<script>alert/.test(preview.body));
  assert.ok(!preview.body.includes('href="javascript:'));
  assert.ok(preview.body.includes('<title>Hello world, a first post'));

  assert.equal(
    (await app.inject({ method: 'GET', url: '/preview/nope-nope-nope-nope-nope-nope' })).statusCode,
    404,
  );
});

test('validation: 422 with field errors; unknown id 404; slug collision 409', async (t) => {
  const { app, close } = await makeApp();
  t.after(close);
  const bad = await call(app, KEYS.writer, 'POST', '/posts', {
    ...draft,
    title: 'short',
    tags: [],
  });
  assert.equal(bad.statusCode, 422);
  assert.equal(bad.json().error, 'validation_failed');
  assert.match(bad.json().message, /title|tags/);

  assert.equal(
    (await call(app, KEYS.writer, 'POST', '/posts', { ...draft, slug: 'Bad Slug' })).statusCode,
    422,
  );
  assert.equal(
    (await call(app, KEYS.writer, 'POST', '/posts', { ...draft, extra: 1 })).statusCode,
    201,
    'unknown fields are stripped',
  );
  assert.equal((await call(app, KEYS.reader, 'GET', '/posts/999')).statusCode, 404);

  const dup = await call(app, KEYS.writer, 'POST', '/posts', draft);
  assert.equal(dup.statusCode, 409);
  assert.equal(dup.json().error, 'slug_conflict');
  assert.equal(typeof dup.json().id, 'number');
});

test('scopes: write cannot publish or read leads; read cannot write; publisher can publish', async (t) => {
  const { app, close } = await makeApp();
  t.after(close);
  const { id } = (await call(app, KEYS.writer, 'POST', '/posts', draft)).json();
  assert.equal((await call(app, KEYS.writer, 'POST', `/posts/${id}/publish`)).statusCode, 403);
  assert.equal((await call(app, KEYS.reader, 'POST', '/posts', draft)).statusCode, 403);
  assert.equal((await call(app, KEYS.publisher, 'GET', '/leads')).statusCode, 403);
  assert.equal(
    (await call(app, KEYS.admin, 'GET', '/posts')).statusCode,
    403,
    'admin does not imply content',
  );
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/posts' })).statusCode, 401);
  assert.equal((await call(app, KEYS.publisher, 'POST', `/posts/${id}/publish`)).statusCode, 200);
});

test('publish renders the page, emits post.published, and the audit trail names the keys', async (t) => {
  const { app, db, distDir, close } = await makeApp({ render: true });
  t.after(close);
  const { id } = (await call(app, KEYS.writer, 'POST', '/posts', draft)).json();
  const pub = await call(app, KEYS.publisher, 'POST', `/posts/${id}/publish`);
  assert.equal(pub.statusCode, 200);
  assert.equal(pub.json().status, 'published');
  assert.equal(pub.json().live_version, 1);
  assert.equal(pub.json().url, 'https://example.test/blog/hello-world');

  await sleep(60); // past the 10 ms render debounce
  assert.ok(fs.existsSync(path.join(distDir, 'blog/hello-world.html')));
  const page = await app.inject({ method: 'GET', url: '/blog/hello-world' });
  assert.equal(page.statusCode, 200);
  assert.ok(page.body.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));

  const events = /** @type {any[]} */ (db.prepare('SELECT event_type, payload FROM outbox').all());
  assert.deepEqual(
    events.map((e) => e.event_type),
    ['post.published'],
  );
  const payload = JSON.parse(events[0].payload);
  assert.deepEqual(payload, {
    id,
    slug: 'hello-world',
    version: 1,
    url: 'https://example.test/blog/hello-world',
  });

  const trail = listAudit(db, { targetType: 'post', targetId: id }).map(
    (r) => `${r.key_name}:${r.action}`,
  );
  assert.deepEqual(trail, ['publisher:post.publish', 'writer:post.create']);
});

test('PATCH: new version, If-Match, live page unchanged until publish, revert restores the body', async (t) => {
  const { app, distDir, close } = await makeApp({ render: true });
  t.after(close);
  const { id } = (await call(app, KEYS.writer, 'POST', '/posts', draft)).json();
  await call(app, KEYS.publisher, 'POST', `/posts/${id}/publish`);
  await sleep(60);

  const stale = await call(
    app,
    KEYS.writer,
    'PATCH',
    `/posts/${id}`,
    { body: 'Second body.' },
    { 'if-match': '"9"' },
  );
  assert.equal(stale.statusCode, 412);
  assert.equal(stale.json().version, 1);

  const v2 = await call(
    app,
    KEYS.writer,
    'PATCH',
    `/posts/${id}`,
    { body: 'Second body.' },
    { 'if-match': '"1"' },
  );
  assert.equal(v2.statusCode, 200);
  assert.equal(v2.json().head_version, 2);
  assert.equal(v2.json().live_version, 1);
  assert.equal(v2.json().live_differs, true);
  await sleep(60);
  const live = fs.readFileSync(path.join(distDir, 'blog/hello-world.html'), 'utf8');
  assert.ok(
    live.includes('Plain paragraph.') && !live.includes('Second body.'),
    'live page untouched',
  );

  assert.equal(
    (await call(app, KEYS.writer, 'PATCH', `/posts/${id}`, {})).statusCode,
    422,
    'empty patch',
  );
  assert.equal(
    (await call(app, KEYS.writer, 'PATCH', `/posts/${id}`, { body: 'x' }, { 'if-match': 'abc' }))
      .statusCode,
    400,
  );

  const versions = await call(app, KEYS.reader, 'GET', `/posts/${id}/versions`);
  assert.deepEqual(
    versions.json().items.map((/** @type {any} */ v) => v.version),
    [2, 1],
  );
  assert.ok(!('body' in versions.json().items[0]));

  const revert = await call(app, KEYS.publisher, 'POST', `/posts/${id}/revert/1`);
  assert.equal(revert.statusCode, 200);
  assert.equal(revert.json().head_version, 3);
  assert.equal(revert.json().live_version, 3, 'published post: revert goes live');
  assert.equal(revert.json().body, draft.body);
  assert.equal((await call(app, KEYS.publisher, 'POST', `/posts/${id}/revert/42`)).statusCode, 404);
});

test('slugs: renamable while a draft, immutable once published; delete redirects the old URL', async (t) => {
  const { app, close } = await makeApp({ render: true });
  t.after(close);
  const { id } = (await call(app, KEYS.writer, 'POST', '/posts', draft)).json();
  const renamed = await call(app, KEYS.writer, 'PATCH', `/posts/${id}`, { slug: 'hello-again' });
  assert.equal(renamed.statusCode, 200);
  assert.equal(renamed.json().slug, 'hello-again');

  await call(app, KEYS.publisher, 'POST', `/posts/${id}/publish`);
  const frozen = await call(app, KEYS.writer, 'PATCH', `/posts/${id}`, { slug: 'hello-third' });
  assert.equal(frozen.statusCode, 422);
  assert.equal(frozen.json().error, 'slug_immutable');
  assert.equal(
    (
      await call(app, KEYS.writer, 'PATCH', `/posts/${id}`, {
        slug: 'hello-again',
        body: 'same slug is fine',
      })
    ).statusCode,
    200,
  );

  const unpub = await call(app, KEYS.publisher, 'POST', `/posts/${id}/unpublish`);
  assert.equal(unpub.statusCode, 200);
  assert.equal(unpub.json().status, 'unpublished');
  assert.equal((await call(app, KEYS.publisher, 'POST', `/posts/${id}/unpublish`)).statusCode, 409);
  await sleep(60);
  assert.equal((await app.inject({ method: 'GET', url: '/blog/hello-again' })).statusCode, 404);

  assert.equal((await call(app, KEYS.writer, 'DELETE', `/posts/${id}`)).statusCode, 403);
  const del = await call(app, KEYS.publisher, 'DELETE', `/posts/${id}`);
  assert.equal(del.statusCode, 200);
  await sleep(60);
  const gone = await app.inject({ method: 'GET', url: '/blog/hello-again' });
  assert.equal(gone.statusCode, 301);
  assert.equal(gone.headers.location, '/blog');
  assert.equal((await call(app, KEYS.reader, 'GET', `/posts/${id}`)).statusCode, 404);
  assert.equal(
    (await call(app, KEYS.writer, 'PATCH', `/posts/${id}`, { body: 'x' })).statusCode,
    404,
  );
  assert.equal(
    (await call(app, KEYS.writer, 'POST', '/posts', { ...draft, slug: 'hello-again' })).statusCode,
    409,
    'deleted slugs stay reserved',
  );
});

test('listing paginates newest-updated first and filters by status; idempotent replay returns the 201', async (t) => {
  const { app, clock, close } = await makeApp();
  t.after(close);
  const ids = [];
  for (let i = 0; i < 3; i++) {
    ids.push(
      (await call(app, KEYS.writer, 'POST', '/posts', { ...draft, slug: `post-${i}` })).json().id,
    );
    clock.advance(1000);
  }
  await call(app, KEYS.publisher, 'POST', `/posts/${ids[0]}/publish`);

  const page1 = await call(app, KEYS.reader, 'GET', '/posts?limit=2');
  assert.deepEqual(
    page1.json().items.map((/** @type {any} */ p) => p.slug),
    ['post-0', 'post-2'],
  );
  const page2 = await call(
    app,
    KEYS.reader,
    'GET',
    `/posts?limit=2&cursor=${page1.json().next_cursor}`,
  );
  assert.deepEqual(
    page2.json().items.map((/** @type {any} */ p) => p.slug),
    ['post-1'],
  );
  assert.equal(page2.json().next_cursor, null);
  assert.deepEqual(
    (await call(app, KEYS.reader, 'GET', '/posts?status=published'))
      .json()
      .items.map((/** @type {any} */ p) => p.slug),
    ['post-0'],
  );
  assert.equal((await call(app, KEYS.reader, 'GET', '/posts?status=deleted')).statusCode, 422);

  const key = crypto.randomUUID();
  const first = await app.inject({
    method: 'POST',
    url: '/api/v1/posts',
    payload: { ...draft, slug: 'idem' },
    headers: { ...bearer(KEYS.writer), 'idempotency-key': key },
  });
  const replay = await app.inject({
    method: 'POST',
    url: '/api/v1/posts',
    payload: { ...draft, slug: 'idem' },
    headers: { ...bearer(KEYS.writer), 'idempotency-key': key },
  });
  assert.equal(first.statusCode, 201);
  assert.equal(replay.statusCode, 201);
  assert.equal(replay.headers['idempotent-replayed'], 'true');
  assert.equal(replay.json().preview_url, first.json().preview_url);
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/posts',
        payload: draft,
        headers: bearer(KEYS.writer),
      })
    ).statusCode,
    400,
    'Idempotency-Key required',
  );
});
