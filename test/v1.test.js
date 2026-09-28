import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, bearer, KEYS } from './helpers.js';
import { createLead } from '../src/services/leads.js';
import { MINUTE, HOUR } from '../src/lib/time.js';

/** @param {import('better-sqlite3').Database} db @param {import('../src/lib/time.js').Clock} clock @param {number} n */
function seedLeads(db, clock, n) {
  const ids = [];
  for (let i = 0; i < n; i++) {
    ids.push(
      createLead(db, { name: `Lead ${i}`, email: `l${i}@example.test`, message: `msg ${i}` }, clock)
        .lead.id,
    );
    /** @type {any} */ (clock).advance(1000);
  }
  return ids;
}

test('health is public and minimal', async (t) => {
  const { app, close } = await makeApp();
  t.after(close);
  const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true });
});

test('auth: 401 unknown key, 403 wrong scope, 200 right scope', async (t) => {
  const { app, close } = await makeApp();
  t.after(close);
  const get = (/** @type {Record<string, string>} */ headers) =>
    app.inject({ method: 'GET', url: '/api/v1/leads', headers });
  assert.equal((await get({})).statusCode, 401);
  assert.equal((await get(bearer('wrong'))).statusCode, 401);
  assert.equal((await get({ authorization: 'Basic abc' })).statusCode, 401);
  assert.equal((await get(bearer(KEYS.admin))).statusCode, 403);
  assert.equal((await get(bearer(KEYS.reader))).statusCode, 200);
});

test('leads list paginates by (created_at, id) with an opaque cursor', async (t) => {
  const { app, db, clock, close } = await makeApp();
  t.after(close);
  seedLeads(db, clock, 5);
  const page1 = await app.inject({
    method: 'GET',
    url: '/api/v1/leads?limit=2',
    headers: bearer(KEYS.reader),
  });
  const body1 = page1.json();
  assert.equal(body1.items.length, 2);
  assert.ok(body1.next_cursor);
  assert.equal(body1.items[0].name, 'Lead 0');
  assert.ok(!('dedupe_hash' in body1.items[0]));

  const page2 = await app.inject({
    method: 'GET',
    url: `/api/v1/leads?limit=2&cursor=${body1.next_cursor}`,
    headers: bearer(KEYS.reader),
  });
  assert.equal(page2.json().items[0].name, 'Lead 2');

  const page3 = await app.inject({
    method: 'GET',
    url: `/api/v1/leads?limit=10&cursor=${page2.json().next_cursor}`,
    headers: bearer(KEYS.reader),
  });
  assert.equal(page3.json().items.length, 1);
  assert.equal(page3.json().next_cursor, null);

  const bad = await app.inject({
    method: 'GET',
    url: '/api/v1/leads?cursor=!!',
    headers: bearer(KEYS.reader),
  });
  assert.equal(bad.statusCode, 400);
});

test('PATCH lead: If-Match, version bump, no lead.updated event for n8n edits', async (t) => {
  const { app, db, clock, close } = await makeApp();
  t.after(close);
  const [id] = seedLeads(db, clock, 1);
  const patch = (/** @type {object} */ body, /** @type {object} */ headers = {}) =>
    app.inject({
      method: 'PATCH',
      url: `/api/v1/leads/${id}`,
      payload: body,
      headers: { ...bearer(KEYS.writer), 'idempotency-key': crypto.randomUUID(), ...headers },
    });

  const ok = await patch({ status: 'contacted', tags: ['warm'] }, { 'if-match': '"1"' });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().version, 2);
  assert.deepEqual(ok.json().tags, ['warm']);
  assert.equal(ok.headers.etag, '"2"');

  const stale = await patch({ notes: 'late' }, { 'if-match': '1' });
  assert.equal(stale.statusCode, 412);
  assert.equal(stale.json().version, 2);

  assert.equal((await patch({ status: 'bogus' })).statusCode, 422);
  assert.equal((await patch({})).statusCode, 422);
  assert.equal((await patch({ notes: 'x' }, { 'if-match': 'abc' })).statusCode, 400);

  const reader = await app.inject({
    method: 'PATCH',
    url: `/api/v1/leads/${id}`,
    payload: { notes: 'x' },
    headers: { ...bearer(KEYS.reader), 'idempotency-key': 'k' },
  });
  assert.equal(reader.statusCode, 403);

  const events = db
    .prepare(`SELECT event_type FROM outbox`)
    .all()
    .map((r) => /** @type {any} */ (r).event_type);
  assert.deepEqual(events, ['lead.created']);
});

test('idempotency: replay returns the stored response; different body is 422', async (t) => {
  const { app, db, clock, close } = await makeApp();
  t.after(close);
  const [id] = seedLeads(db, clock, 1);
  const send = (/** @type {object} */ body, key = 'op-1') =>
    app.inject({
      method: 'PATCH',
      url: `/api/v1/leads/${id}`,
      payload: body,
      headers: { ...bearer(KEYS.writer), 'idempotency-key': key },
    });

  assert.equal(
    (
      await app.inject({
        method: 'PATCH',
        url: `/api/v1/leads/${id}`,
        payload: { notes: 'n' },
        headers: bearer(KEYS.writer),
      })
    ).statusCode,
    400,
  );

  const first = await send({ status: 'qualified' });
  assert.equal(first.statusCode, 200);
  assert.equal(first.json().version, 2);

  const replay = await send({ status: 'qualified' });
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.headers['idempotent-replayed'], 'true');
  assert.deepEqual(replay.json(), first.json());
  assert.equal(
    /** @type {any} */ (db.prepare('SELECT version FROM leads WHERE id = ?').get(id)).version,
    2,
  );

  const mismatch = await send({ status: 'won' });
  assert.equal(mismatch.statusCode, 422);
  assert.equal(mismatch.json().error, 'idempotency_key_reused');

  // Keys are scoped per API key name: the same key from another caller is a fresh request.
  const other = await app.inject({
    method: 'PATCH',
    url: `/api/v1/leads/${id}`,
    payload: { status: 'won' },
    headers: { ...bearer(KEYS.admin), 'idempotency-key': 'op-1' },
  });
  assert.equal(other.statusCode, 403); // admin lacks leads:write, but auth ran before idempotency

  // After 24h the record is gone and the key can be reused.
  clock.advance(25 * HOUR);
  const { purgeIdempotencyKeys } = await import('../src/services/idempotency.js');
  purgeIdempotencyKeys(db, new Date(clock.now()).toISOString());
  assert.equal((await send({ status: 'won' })).statusCode, 200);
});

test('idempotency: an in-progress duplicate gets 409, a stale one is taken over', async (t) => {
  const { app, db, clock, close } = await makeApp();
  t.after(close);
  const [id] = seedLeads(db, clock, 1);
  db.prepare(
    `INSERT INTO idempotency_keys (key_name, idempotency_key, request_hash, created_at) VALUES ('writer', 'stuck', 'x', ?)`,
  ).run(new Date(clock.now()).toISOString());

  const send = () =>
    app.inject({
      method: 'PATCH',
      url: `/api/v1/leads/${id}`,
      payload: { notes: 'n' },
      headers: { ...bearer(KEYS.writer), 'idempotency-key': 'stuck' },
    });
  // Different hash from 'x' → mismatch wins over in_progress.
  assert.equal((await send()).statusCode, 422);

  db.prepare(`UPDATE idempotency_keys SET request_hash = ? WHERE idempotency_key = 'stuck'`).run(
    (await import('../src/lib/crypto.js')).sha256(`PATCH /api/v1/leads/${id}\n{"notes":"n"}`),
  );
  const busy = await send();
  assert.equal(busy.statusCode, 409);
  assert.equal(busy.headers['retry-after'], '2');

  clock.advance(2 * MINUTE);
  assert.equal((await send()).statusCode, 200);
});

test('admin: status and dead-letter listing/retry', async (t) => {
  const { app, db, clock, close } = await makeApp();
  t.after(close);
  seedLeads(db, clock, 2);
  db.prepare(`UPDATE outbox SET status = 'dead', last_error = 'HTTP 400' WHERE id = 1`).run();

  const status = await app.inject({
    method: 'GET',
    url: '/api/v1/status',
    headers: bearer(KEYS.admin),
  });
  assert.equal(status.statusCode, 200);
  assert.deepEqual(status.json().outbox, {
    pending: 1,
    dead: 1,
    delivered: 0,
    last_delivered_at: null,
  });
  assert.ok(!JSON.stringify(status.json()).includes('example.test'));

  const dead = await app.inject({
    method: 'GET',
    url: '/api/v1/outbox',
    headers: bearer(KEYS.admin),
  });
  assert.equal(dead.json().items.length, 1);
  assert.ok(!('payload' in dead.json().items[0]));

  const retry = await app.inject({
    method: 'POST',
    url: '/api/v1/outbox/1/retry',
    headers: { ...bearer(KEYS.admin), 'idempotency-key': 'r1' },
  });
  assert.equal(retry.statusCode, 200);
  assert.equal(
    /** @type {any} */ (db.prepare('SELECT status FROM outbox WHERE id = 1').get()).status,
    'pending',
  );

  const again = await app.inject({
    method: 'POST',
    url: '/api/v1/outbox/1/retry',
    headers: { ...bearer(KEYS.admin), 'idempotency-key': 'r2' },
  });
  assert.equal(again.statusCode, 404);
  assert.equal(
    (await app.inject({ method: 'GET', url: '/api/v1/status', headers: bearer(KEYS.reader) }))
      .statusCode,
    403,
  );
});
