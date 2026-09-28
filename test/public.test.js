import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from './helpers.js';
import { MINUTE } from '../src/lib/time.js';

const lead = {
  name: 'Ada',
  email: 'ada@example.test',
  message: 'Hello there, I have a project.',
  source: '/contact',
};

/** @param {import('fastify').FastifyInstance} app @param {object} body @param {string} [ip] */
const postJson = (app, body, ip = '10.0.0.1') =>
  app.inject({ method: 'POST', url: '/api/contact', payload: body, remoteAddress: ip });

/** @param {import('fastify').FastifyInstance} app @param {Record<string, string>} fields */
const postForm = (app, fields) =>
  app.inject({
    method: 'POST',
    url: '/api/contact',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams(fields).toString(),
    remoteAddress: '10.0.0.2',
  });

/** @param {import('better-sqlite3').Database} db */
const counts = (db) => ({
  leads: /** @type {{n: number}} */ (db.prepare('SELECT COUNT(*) n FROM leads').get()).n,
  outbox: /** @type {{n: number}} */ (db.prepare('SELECT COUNT(*) n FROM outbox').get()).n,
});

test('JSON contact: 202, one lead, one outbox row in the same write', async (t) => {
  const { app, db, close } = await makeApp();
  t.after(close);
  const res = await postJson(app, { ...lead, form_id: crypto.randomUUID() });
  assert.equal(res.statusCode, 202);
  assert.deepEqual(res.json(), { ok: true });
  assert.deepEqual(counts(db), { leads: 1, outbox: 1 });
  const row = /** @type {any} */ (db.prepare('SELECT * FROM outbox').get());
  assert.equal(row.event_type, 'lead.created');
  assert.equal(JSON.parse(row.payload).email, lead.email);
});

test('form contact without JS: 303 to /contact?sent=1', async (t) => {
  const { app, db, close } = await makeApp();
  t.after(close);
  const res = await postForm(app, { ...lead, form_id: '' });
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.location, '/contact?sent=1#sent');
  assert.equal(counts(db).leads, 1);
});

test('form validation error: 303 to /contact?error=validation_failed', async (t) => {
  const { app, db, close } = await makeApp();
  t.after(close);
  const res = await postForm(app, { name: 'x', email: 'not-an-email', message: 'hi' });
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.location, '/contact?error=validation_failed#error');
  assert.equal(counts(db).leads, 0);
});

test('JSON validation error is 422; bad JSON is 400; oversize is 413', async (t) => {
  const { app, db, close } = await makeApp();
  t.after(close);
  assert.equal((await postJson(app, { ...lead, email: 'nope' })).statusCode, 422);
  assert.equal((await postJson(app, { ...lead, message: '' })).statusCode, 422);

  // Unknown fields are stripped (Fastify's Ajv default), not rejected: plain
  // form posts carry things like submit-button names.
  assert.equal((await postJson(app, { ...lead, extra: 1 })).statusCode, 202);
  assert.equal(counts(db).leads, 1);

  const broken = await app.inject({
    method: 'POST',
    url: '/api/contact',
    headers: { 'content-type': 'application/json' },
    payload: '{not json',
  });
  assert.equal(broken.statusCode, 400);

  const big = await postJson(app, { ...lead, message: 'x'.repeat(20_000) });
  assert.equal(big.statusCode, 413);
});

test('honeypot: 202 and nothing stored', async (t) => {
  const { app, db, close } = await makeApp();
  t.after(close);
  const res = await postJson(app, { ...lead, website: 'http://spam.example' });
  assert.equal(res.statusCode, 202);
  assert.deepEqual(counts(db), { leads: 0, outbox: 0 });
});

test('dedupe on form_id: concurrent identical submissions create one lead and one outbox row', async (t) => {
  const { app, db, close } = await makeApp();
  t.after(close);
  const body = { ...lead, form_id: crypto.randomUUID() };
  const results = await Promise.all([
    postJson(app, body),
    postJson(app, body),
    postJson(app, body),
  ]);
  assert.deepEqual(
    results.map((r) => r.statusCode),
    [202, 202, 202],
  );
  assert.deepEqual(counts(db), { leads: 1, outbox: 1 });
});

test('dedupe without form_id: same email+message within 10 minutes is one lead', async (t) => {
  const { app, db, clock, close } = await makeApp();
  t.after(close);
  await Promise.all([postForm(app, lead), postForm(app, lead)]);
  assert.deepEqual(counts(db), { leads: 1, outbox: 1 });

  clock.advance(11 * MINUTE);
  await postForm(app, lead);
  assert.deepEqual(counts(db), { leads: 2, outbox: 2 });
});

test('rate limit: 6th request from one IP within 10 minutes is 429 with Retry-After', async (t) => {
  const { app, close } = await makeApp();
  t.after(close);
  for (let i = 0; i < 5; i++) {
    const res = await postJson(app, { ...lead, message: `m${i}` }, '10.9.9.9');
    assert.equal(res.statusCode, 202, `request ${i}`);
  }
  const blocked = await postJson(app, { ...lead, message: 'm6' }, '10.9.9.9');
  assert.equal(blocked.statusCode, 429);
  assert.ok(blocked.headers['retry-after']);
  assert.equal(blocked.json().error, 'rate_limited');

  // Another IP is unaffected, and /api/subscribe has its own bucket.
  assert.equal((await postJson(app, lead, '10.9.9.10')).statusCode, 202);
  const sub = await app.inject({
    method: 'POST',
    url: '/api/subscribe',
    payload: { email: 'ada@example.test', list: 'newsletter' },
    remoteAddress: '10.9.9.9',
  });
  assert.equal(sub.statusCode, 202);
});

test('subscribe: validates list, dedupes email+list, stores nothing for honeypot', async (t) => {
  const { app, db, close } = await makeApp();
  t.after(close);
  const post = (/** @type {object} */ payload) =>
    app.inject({ method: 'POST', url: '/api/subscribe', payload });

  assert.equal((await post({ email: 'a@b.test', list: 'bogus' })).statusCode, 422);
  assert.equal((await post({ email: 'a@b.test', list: 'magnet:the-guide' })).statusCode, 202);
  assert.equal((await post({ email: 'A@B.test', list: 'magnet:the-guide' })).statusCode, 202);
  assert.equal(
    (await post({ email: 'a@b.test', list: 'newsletter', website: 'x' })).statusCode,
    202,
  );
  const n = /** @type {{n: number}} */ (db.prepare('SELECT COUNT(*) n FROM subscribers').get()).n;
  assert.equal(n, 1);
});

test('security headers and unknown API route', async (t) => {
  const { app, close } = await makeApp();
  t.after(close);
  const res = await app.inject({ method: 'GET', url: '/api/nope' });
  assert.equal(res.statusCode, 404);
  assert.match(String(res.headers['content-security-policy']), /script-src 'self'/);
  assert.equal(res.headers['x-frame-options'], 'SAMEORIGIN');
});
