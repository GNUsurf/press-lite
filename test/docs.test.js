import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from './helpers.js';
import { OPERATIONS, WEBHOOK_EVENTS } from '../src/lib/openapi.js';

test('openapi.json describes every API route, and every route has prose', async (t) => {
  const { app, close } = await makeApp({ render: true });
  t.after(close);
  const res = await app.inject({ method: 'GET', url: '/api/v1/openapi.json' });
  assert.equal(res.statusCode, 200);
  const api = res.json();
  assert.equal(api.openapi, '3.1.0');
  assert.equal(api.servers[0].url, 'https://example.test');

  // Every registered API/preview route (except HEAD twins) must appear, with a summary.
  const registered = app
    .printRoutes({ commonPrefix: false })
    .split('\n')
    .map((line) => /^\s*(\S+) \((\S+)/.exec(line) ?? /^\s*(\S+) \((\S+)/.exec(line));
  const documented = new Set(
    Object.entries(api.paths).flatMap(([p, ops]) =>
      Object.keys(ops).map((m) => `${m.toUpperCase()} ${p.replace(/\{(\w+)\}/g, ':$1')}`),
    ),
  );
  const expected = Object.keys(OPERATIONS);
  for (const key of expected) assert.ok(documented.has(key), `${key} missing from openapi.json`);
  assert.equal(documented.size, expected.length, 'no undocumented routes');
  for (const ops of Object.values(api.paths)) {
    for (const op of Object.values(ops)) {
      assert.ok(/** @type {any} */ (op).summary && /** @type {any} */ (op).description);
    }
  }
  assert.ok(registered.length > 0);
});

test('every route Fastify registered under /api or /preview has an OPERATIONS entry', async (t) => {
  const { app, close } = await makeApp();
  t.after(close);
  /** @type {string[]} */
  const missing = [];
  const tree = app.printRoutes({ commonPrefix: false, includeHooks: false });
  for (const line of tree.split('\n')) {
    const m = /^[\s│├└─]*(\/\S*) \(([A-Z, ]+)\)/.exec(line);
    if (!m) continue;
    const [, url, methods] = m;
    if (!(url.startsWith('/api/') || url.startsWith('/preview/'))) continue;
    for (const method of methods.split(', ')) {
      if (method === 'HEAD' || method === 'OPTIONS') continue;
      if (!OPERATIONS[`${method} ${url}`]) missing.push(`${method} ${url}`);
    }
  }
  assert.deepEqual(missing, [], 'add an OPERATIONS entry in src/lib/openapi.js for each');
});

test('operations carry scope, idempotency, schemas and responses from the routes', async (t) => {
  const { app, close } = await makeApp();
  t.after(close);
  const api = (await app.inject({ method: 'GET', url: '/api/v1/openapi.json' })).json();

  const create = api.paths['/api/v1/posts'].post;
  assert.equal(create['x-scope'], 'content:write');
  assert.deepEqual(create.security, [{ bearer: [] }]);
  assert.ok(create.parameters.some((/** @type {any} */ p) => p.$ref?.endsWith('IdempotencyKey')));
  assert.equal(
    create.requestBody.content['application/json'].schema.properties.title.minLength,
    10,
  );
  assert.equal(create.responses['201'].description.includes('preview_url'), true);
  assert.ok(create.responses['401'] && create.responses['422']);

  const patch = api.paths['/api/v1/leads/{id}'].patch;
  assert.ok(patch.parameters.some((/** @type {any} */ p) => p.$ref?.endsWith('IfMatch')));
  assert.ok(patch.parameters.some((/** @type {any} */ p) => p.name === 'id' && p.in === 'path'));

  const health = api.paths['/api/v1/health'].get;
  assert.equal(health.security, undefined);
  assert.equal(health.responses['401'], undefined, 'public routes do not list auth errors');

  const contact = api.paths['/api/contact'].post;
  assert.ok(contact.requestBody.content['application/x-www-form-urlencoded']);

  assert.deepEqual(Object.keys(api.webhooks).sort(), Object.keys(WEBHOOK_EVENTS).sort());
  assert.ok(api.webhooks['post.published'].post.description.includes('event_id'));
});

test('/docs renders the reference from the same document, with the site layout and no scripts', async (t) => {
  const { app, close } = await makeApp({ render: true });
  t.after(close);
  const res = await app.inject({ method: 'GET', url: '/docs' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['x-robots-tag'], 'noindex');
  const page = res.body;
  assert.ok(page.includes('<title>API'));
  for (const key of Object.keys(OPERATIONS)) {
    const [, p] = key.split(' ');
    assert.ok(page.includes(`<code>${p.replace(/:(\w+)/g, '{$1}')}</code>`), `${p} not on /docs`);
  }
  assert.ok(page.includes('scope: content:publish'));
  assert.ok(page.includes('Idempotency-Key'));
  assert.ok(page.includes('post.published'));
  assert.ok(!page.includes('<script>'), 'no inline scripts (CSP)');
  assert.match(page, /<script src="\/assets\/site\.[0-9a-f]{12}\.js" defer><\/script>/);
});

test('/docs is 503 with a pointer to the JSON before the first render', async (t) => {
  const { app, close } = await makeApp();
  t.after(close);
  const res = await app.inject({ method: 'GET', url: '/docs' });
  assert.equal(res.statusCode, 503);
  assert.equal(res.json().openapi, '/api/v1/openapi.json');
});
