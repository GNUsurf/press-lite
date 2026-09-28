import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createOutboxWorker,
  backoffMs,
  BACKOFF_MS,
  BACKOFF_TAIL_MS,
  LEASE_MS,
} from '../src/worker/outbox.js';
import { openDatabase } from '../src/db/index.js';
import { createLead } from '../src/services/leads.js';
import { hmacSha256 } from '../src/lib/crypto.js';
import { SECOND, MINUTE, HOUR, toIso } from '../src/lib/time.js';
import { fakeClock, fakeN8n, fakeLog, tmpDir, N8N } from './helpers.js';

const env = { n8nWebhookUrl: N8N.url, n8nWebhookToken: N8N.token, n8nSigningSecret: N8N.secret };

/** @param {{ memory?: boolean, mode?: Parameters<typeof fakeN8n>[0], dir?: string }} [options] */
function setup({ memory = true, mode = 'ok', dir = tmpDir() } = {}) {
  const clock = fakeClock();
  const db = openDatabase(dir, { memory });
  const n8n = fakeN8n(mode);
  const log = fakeLog();
  const worker = createOutboxWorker({
    db,
    env,
    log,
    clock,
    fetch: n8n.fetch,
    timeoutMs: 50,
    random: () => 0.5, // no jitter: deterministic schedule
  });
  const { lead } = createLead(db, { name: 'A', email: 'a@x.test', message: 'hi' }, clock);
  return { clock, db, n8n, log, worker, lead, dir };
}

/** @param {import('better-sqlite3').Database} db */
const row = (db) =>
  /** @type {any} */ (db.prepare('SELECT * FROM outbox ORDER BY id LIMIT 1').get());

test('delivers a signed event and records delivered_at', async () => {
  const { db, n8n, worker, clock, lead } = setup();
  assert.equal(await worker.tick(), 1);

  const r = row(db);
  assert.equal(r.status, 'delivered');
  assert.equal(r.delivered_at, toIso(clock.now()));
  assert.equal(r.lease_until, null);

  const [req] = n8n.requests;
  assert.equal(req.url, N8N.url);
  assert.equal(req.headers['x-webhook-token'], N8N.token);
  assert.equal(req.headers['x-event-id'], r.event_id);
  assert.equal(req.headers['x-event-type'], 'lead.created');
  const expected = `sha256=${hmacSha256(N8N.secret, `${req.headers['x-timestamp']}.${req.body}`)}`;
  assert.equal(req.headers['x-signature'], expected);
  const body = JSON.parse(req.body);
  assert.deepEqual(Object.keys(body), ['event_id', 'event_type', 'occurred_at', 'data']);
  assert.equal(body.data.id, lead.id);
  assert.equal(body.data.email, 'a@x.test');

  assert.equal(await worker.tick(), 0);
});

test('500 from n8n: retried on the backoff schedule, dead after 48h', async () => {
  const { db, n8n, worker, clock } = setup({ mode: 'error500' });
  await worker.tick();
  let r = row(db);
  assert.equal(r.status, 'pending');
  assert.equal(r.attempts, 1);
  assert.equal(r.last_error, 'HTTP 500');
  assert.equal(r.next_attempt_at, toIso(clock.now() + 30 * SECOND));
  assert.equal(await worker.tick(), 0, 'not due yet');

  const waits = [2 * MINUTE, 10 * MINUTE, 30 * MINUTE, 2 * HOUR, 6 * HOUR, 6 * HOUR];
  for (const expected of waits) {
    clock.set(Date.parse(row(db).next_attempt_at));
    assert.equal(await worker.tick(), 1);
    r = row(db);
    assert.equal(r.status, 'pending');
    assert.equal(r.next_attempt_at, toIso(clock.now() + expected));
  }

  clock.set(Date.parse(r.dead_after));
  await worker.tick();
  r = row(db);
  assert.equal(r.status, 'dead');
  assert.ok(n8n.requests.length >= 8);
  assert.equal(await worker.tick(), 0);
});

test('hang past the timeout counts as a retryable failure', async () => {
  const { db, worker, log } = setup({ mode: 'hang' });
  const started = Date.now();
  await worker.tick();
  assert.ok(Date.now() - started < 2000, 'aborted by timeout');
  const r = row(db);
  assert.equal(r.status, 'pending');
  assert.match(r.last_error, /TimeoutError/);
  assert.equal(log.entries.at(-1)?.level, 'warn');
});

test('network error is retried; 4xx other than 408/429 is dead immediately', async () => {
  const net = setup({ mode: 'network' });
  await net.worker.tick();
  assert.equal(row(net.db).status, 'pending');
  assert.match(row(net.db).last_error, /ECONNREFUSED/);

  const bad = setup({ mode: 'error400' });
  await bad.worker.tick();
  assert.equal(row(bad.db).status, 'dead');
  assert.equal(row(bad.db).last_error, 'HTTP 400');
  assert.equal(bad.log.entries.at(-1)?.level, 'error');
});

test('n8n returns 200, worker dies before recording: redelivered with the same event_id', async () => {
  const dir = tmpDir();
  const first = setup({ memory: false, dir });
  const { event_id: eventId } = row(first.db);

  // "Kill" the process between n8n's 2xx and our write: close the DB
  // handle in the response path, so markDelivered throws.
  first.n8n.beforeResponse = () => first.db.close();
  await assert.rejects(first.worker.tick());
  assert.equal(first.n8n.requests.length, 1);

  // Restart: new process, same file. The lease is still held...
  const second = createOutboxWorker({
    db: openDatabase(dir),
    env,
    log: fakeLog(),
    clock: first.clock,
    fetch: fakeN8n('ok').fetch,
  });
  const db2 = openDatabase(dir);
  assert.equal(row(db2).status, 'pending');
  assert.equal(await second.tick(), 0, 'leased row is not re-sent before the lease expires');

  // ...until it expires, then the same event goes out again.
  first.clock.advance(LEASE_MS + 1);
  const n8n2 = fakeN8n('ok');
  const third = createOutboxWorker({
    db: db2,
    env,
    log: fakeLog(),
    clock: first.clock,
    fetch: n8n2.fetch,
  });
  assert.equal(await third.tick(), 1);
  assert.equal(n8n2.requests[0].headers['x-event-id'], eventId);
  assert.equal(row(db2).status, 'delivered');
  assert.equal(row(db2).attempts, 2);
});

test('start/stop runs ticks on the interval and stops cleanly', async () => {
  const { db, worker } = setup();
  const w = createOutboxWorker({
    db,
    env,
    log: fakeLog(),
    fetch: fakeN8n('ok').fetch,
    intervalMs: 5,
  });
  w.start();
  w.start(); // idempotent
  await new Promise((r) => setTimeout(r, 40));
  await w.stop();
  assert.equal(row(db).status, 'delivered');
  assert.equal(await worker.tick(), 0);
});

test('backoff schedule with jitter bounds', () => {
  assert.equal(
    backoffMs(1, () => 0.5),
    BACKOFF_MS[0],
  );
  assert.equal(
    backoffMs(5, () => 0.5),
    BACKOFF_MS[4],
  );
  assert.equal(
    backoffMs(6, () => 0.5),
    BACKOFF_TAIL_MS,
  );
  assert.equal(
    backoffMs(99, () => 0.5),
    BACKOFF_TAIL_MS,
  );
  assert.equal(
    backoffMs(1, () => 0),
    BACKOFF_MS[0] * 0.8,
  );
  assert.equal(
    backoffMs(1, () => 1),
    BACKOFF_MS[0] * 1.2,
  );
});
