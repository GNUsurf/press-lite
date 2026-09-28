/**
 * Outbox worker: delivers pending events to n8n, at-least-once.
 *
 * SINGLE-INSTANCE ASSUMPTION. Railway volumes don't allow replicas, so
 * exactly one process runs this loop and an in-process worker is correct.
 * Rows are still claimed with a lease so a restart mid-delivery is safe:
 * the lease expires and the row is picked up again.
 *
 * Duplicates are by design. If the process dies after n8n returns 2xx but
 * before `delivered_at` is written, the event is sent again with the same
 * `event_id`. n8n must dedupe on it.
 *
 * `fetch` and `clock` are injectable so tests can fake n8n and move time.
 */
import { hmacSha256 } from '../lib/crypto.js';
import { SECOND, MINUTE, HOUR, toIso, fromIso, systemClock } from '../lib/time.js';
import { purgeIdempotencyKeys } from '../services/idempotency.js';

export const LEASE_MS = 60 * SECOND;
export const TIMEOUT_MS = 10 * SECOND;
export const BACKOFF_MS = [30 * SECOND, 2 * MINUTE, 10 * MINUTE, 30 * MINUTE, 2 * HOUR];
export const BACKOFF_TAIL_MS = 6 * HOUR;
const JITTER = 0.2;

/** @typedef {import('../services/outbox.js').OutboxRow} OutboxRow */

/**
 * @param {object} options
 * @param {import('../db/index.js').Db} options.db
 * @param {Pick<import('../lib/env.js').Env, 'n8nWebhookUrl' | 'n8nWebhookToken' | 'n8nSigningSecret'>} options.env
 * @param {Pick<import('fastify').FastifyBaseLogger, 'info' | 'warn' | 'error'>} options.log
 * @param {typeof globalThis.fetch} [options.fetch]
 * @param {import('../lib/time.js').Clock} [options.clock]
 * @param {number} [options.intervalMs]   idle poll interval
 * @param {number} [options.timeoutMs]
 * @param {() => number} [options.random]  for jitter; injectable for tests
 */
export function createOutboxWorker({
  db,
  env,
  log,
  fetch = globalThis.fetch,
  clock = systemClock,
  intervalMs = 5 * SECOND,
  timeoutMs = TIMEOUT_MS,
  random = Math.random,
}) {
  const claim = db.prepare(
    `UPDATE outbox SET lease_until = ?, attempts = attempts + 1
     WHERE id = (
       SELECT id FROM outbox
       WHERE status = 'pending' AND next_attempt_at <= ? AND (lease_until IS NULL OR lease_until <= ?)
       ORDER BY next_attempt_at, id LIMIT 1
     )
     RETURNING *`,
  );
  const markDelivered = db.prepare(
    `UPDATE outbox SET status = 'delivered', delivered_at = ?, lease_until = NULL, last_error = NULL
     WHERE id = ?`,
  );
  const markRetry = db.prepare(
    `UPDATE outbox SET next_attempt_at = ?, lease_until = NULL, last_error = ? WHERE id = ?`,
  );
  const markDead = db.prepare(
    `UPDATE outbox SET status = 'dead', lease_until = NULL, last_error = ? WHERE id = ?`,
  );

  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null;
  let running = false;
  /** @type {Promise<unknown> | null} */
  let inFlight = null;

  /** @returns {OutboxRow | undefined} */
  function claimNext() {
    const now = clock.now();
    return /** @type {OutboxRow | undefined} */ (
      claim.get(toIso(now + LEASE_MS), toIso(now), toIso(now))
    );
  }

  /**
   * Send one claimed row. Every outcome is recorded before returning.
   * @param {OutboxRow} row
   */
  async function deliver(row) {
    const timestamp = String(clock.now());
    const body = JSON.stringify({
      event_id: row.event_id,
      event_type: row.event_type,
      occurred_at: row.occurred_at,
      data: JSON.parse(row.payload),
    });
    const headers = {
      'content-type': 'application/json',
      'x-webhook-token': env.n8nWebhookToken,
      'x-event-id': row.event_id,
      'x-event-type': row.event_type,
      'x-timestamp': timestamp,
      'x-signature': `sha256=${hmacSha256(env.n8nSigningSecret, `${timestamp}.${body}`)}`,
    };

    /** @type {{ ok: true } | { ok: false, retry: boolean, error: string }} */
    let outcome;
    try {
      const res = await fetch(env.n8nWebhookUrl, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'error',
      });
      if (res.ok) outcome = { ok: true };
      else
        outcome = { ok: false, retry: isRetryableStatus(res.status), error: `HTTP ${res.status}` };
    } catch (err) {
      // Network failure or timeout: n8n may or may not have seen it. Retry.
      outcome = { ok: false, retry: true, error: describe(err) };
    }

    const now = clock.now();
    if (outcome.ok) {
      markDelivered.run(toIso(now), row.id);
      return;
    }
    if (!outcome.retry) {
      markDead.run(outcome.error, row.id);
      log.error({ event_id: row.event_id, error: outcome.error }, 'outbox: non-retryable, dead');
      return;
    }
    if (now >= fromIso(row.dead_after)) {
      markDead.run(outcome.error, row.id);
      log.error(
        { event_id: row.event_id, attempts: row.attempts, error: outcome.error },
        'outbox: gave up, dead',
      );
      return;
    }
    const next = Math.min(now + backoffMs(row.attempts, random), fromIso(row.dead_after));
    markRetry.run(toIso(next), outcome.error, row.id);
    log.warn(
      {
        event_id: row.event_id,
        attempts: row.attempts,
        error: outcome.error,
        next_attempt_at: toIso(next),
      },
      'outbox: retry',
    );
  }

  /**
   * Drain everything that's due. Returns how many rows were attempted.
   * Safe to call directly from tests.
   */
  async function tick() {
    purgeIdempotencyKeys(db, toIso(clock.now()));
    let count = 0;
    for (let row = claimNext(); row; row = claimNext()) {
      await deliver(row);
      count++;
    }
    return count;
  }

  function schedule() {
    if (!running) return;
    timer = setTimeout(async () => {
      timer = null;
      inFlight = tick().catch((err) => log.error({ err }, 'outbox: tick failed'));
      await inFlight;
      inFlight = null;
      schedule();
    }, intervalMs);
  }

  return {
    tick,
    start() {
      if (running) return;
      running = true;
      log.info({ intervalMs }, 'outbox worker started');
      schedule();
    },
    async stop() {
      running = false;
      if (timer) clearTimeout(timer);
      timer = null;
      if (inFlight) await inFlight;
    },
  };
}

/** @param {number} status */
export function isRetryableStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}

/**
 * Attempt N (1-based) waits BACKOFF_MS[N-1], then the 6h tail, ±20% jitter.
 * @param {number} attempts
 * @param {() => number} random
 */
export function backoffMs(attempts, random = Math.random) {
  const base = BACKOFF_MS[attempts - 1] ?? BACKOFF_TAIL_MS;
  return Math.round(base * (1 + JITTER * (random() * 2 - 1)));
}

/** @param {unknown} err */
function describe(err) {
  if (err instanceof Error) {
    const cause = /** @type {{ cause?: { code?: string } }} */ (err).cause?.code;
    return cause ? `${err.name}: ${cause}` : `${err.name}: ${err.message}`;
  }
  return String(err);
}
