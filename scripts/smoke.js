#!/usr/bin/env node
/**
 * `make smoke`: run the real thing and poke it.
 *
 * Local:  builds the Docker image and runs it when docker is available,
 *         otherwise runs `node src/server.js` directly. Then fetches every
 *         page in the sitemap, the feeds, the assets, and runs the contact
 *         flow with n8n down (the outbox must hold the lead and record a
 *         failed attempt).
 * Remote: `--url https://site` skips the process management and, since it's
 *         production, exercises the contact endpoint via the honeypot so
 *         nothing is stored.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomSecret, sha256 } from '../src/lib/crypto.js';

const args = process.argv.slice(2);
const remoteUrl = args.find((a) => a.startsWith('--url='))?.slice(6);
const PORT = Number(process.env.SMOKE_PORT || 3999);
const IMAGE = 'site-smoke';

/** @type {string[]} */
const failures = [];
const ok = (/** @type {boolean} */ cond, /** @type {string} */ what) => {
  console.log(`${cond ? '  ok ' : ' FAIL'} ${what}`);
  if (!cond) failures.push(what);
};

async function main() {
  const adminKey = randomSecret();
  const env = {
    PORT: String(PORT),
    DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-')),
    SITE_URL: `http://localhost:${PORT}`,
    N8N_WEBHOOK_URL: 'http://127.0.0.1:9/webhook/down', // discard port: n8n is "down"
    N8N_WEBHOOK_TOKEN: 'smoke',
    N8N_SIGNING_SECRET: 'smoke',
    API_KEYS: `smoke:leads:read,leads:write,admin:${sha256(adminKey)}`,
    LOG_LEVEL: 'warn',
  };

  const base = remoteUrl?.replace(/\/$/, '') ?? env.SITE_URL;
  const stop = remoteUrl ? () => {} : await start(env);
  try {
    await waitFor(`${base}/api/v1/health`);
    await checkPages(base);
    if (remoteUrl) await checkContactHoneypot(base);
    else await checkContactFlow(base, adminKey);
  } finally {
    stop();
  }

  if (failures.length) {
    console.error(`\nsmoke: ${failures.length} failure(s)`);
    process.exit(1);
  }
  console.log('\nsmoke: ok');
}

/** @param {Record<string, string>} env @returns {Promise<() => void>} */
async function start(env) {
  const hasDocker = spawnSync('docker', ['version'], { stdio: 'ignore' }).status === 0;
  if (hasDocker) {
    console.log('smoke: building Docker image');
    run('docker', ['build', '--build-arg', `SITE_URL=${env.SITE_URL}`, '-t', IMAGE, '.']);
    const dockerEnv = { ...env, DATA_DIR: '/tmp/data' };
    const envArgs = Object.entries(dockerEnv).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
    const id = run('docker', [
      'run',
      '-d',
      '--rm',
      '-p',
      `${PORT}:${PORT}`,
      ...envArgs,
      IMAGE,
    ]).trim();
    return () => spawnSync('docker', ['stop', id], { stdio: 'ignore' });
  }
  console.log('smoke: docker not found, running node src/server.js directly');
  const child = spawn(process.execPath, ['src/server.js'], {
    env: { ...process.env, ...env },
    stdio: 'inherit',
  });
  return () => child.kill('SIGTERM');
}

/** @param {string} cmd @param {string[]} argv */
function run(cmd, argv) {
  const result = spawnSync(cmd, argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  if (result.status !== 0) throw new Error(`${cmd} ${argv.join(' ')} failed`);
  return result.stdout;
}

/** @param {string} url */
async function waitFor(url, attempts = 60) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  throw new Error(`${url} did not come up`);
}

/** @param {string} base */
async function checkPages(base) {
  const sitemap = await fetch(`${base}/sitemap.xml`);
  ok(sitemap.status === 200, 'GET /sitemap.xml');
  const urls = [...(await sitemap.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map(
    (m) => new URL(m[1]).pathname,
  );
  ok(urls.includes('/') && urls.includes('/contact'), `sitemap lists ${urls.length} pages`);

  for (const p of urls) {
    const res = await fetch(`${base}${p}`);
    const body = await res.text();
    ok(res.status === 200 && body.includes('<title>'), `GET ${p}`);
    ok(
      String(res.headers.get('content-security-policy')).includes("script-src 'self'"),
      `CSP on ${p}`,
    );
  }

  const home = await (await fetch(base)).text();
  for (const asset of [...home.matchAll(/(?:href|src)="(\/assets\/[^"]+)"/g)].map((m) => m[1])) {
    const res = await fetch(`${base}${asset}`);
    ok(res.status === 200, `GET ${asset}`);
    ok(
      String(res.headers.get('cache-control')).includes('immutable'),
      `immutable cache on ${asset}`,
    );
  }

  for (const p of [
    '/robots.txt',
    '/feed.xml',
    '/favicon.svg',
    '/og-default.png',
    '/hero-poster.jpg',
  ]) {
    ok((await fetch(`${base}${p}`)).status === 200, `GET ${p}`);
  }
  const missing = await fetch(`${base}/definitely-not-here`);
  ok(missing.status === 404 && (await missing.text()).includes('Page not found'), '404 page');
  const missingApi = await fetch(`${base}/api/nope`);
  ok(
    missingApi.status === 404 && (await missingApi.json()).error === 'not_found',
    '404 JSON under /api',
  );
}

/** @param {string} base @param {string} adminKey */
async function checkContactFlow(base, adminKey) {
  const lead = {
    name: 'Smoke Test',
    email: 'smoke@example.test',
    message: 'Smoke test message.',
    form_id: crypto.randomUUID(),
  };
  const json = await fetch(`${base}/api/contact`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(lead),
  });
  ok(json.status === 202, 'POST /api/contact (JSON) → 202');
  const dup = await fetch(`${base}/api/contact`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(lead),
  });
  ok(dup.status === 202, 'duplicate form_id → 202');

  const form = await fetch(`${base}/api/contact`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      name: 'Form Test',
      email: 'form@example.test',
      message: 'Plain form post.',
    }),
    redirect: 'manual',
  });
  ok(
    form.status === 303 && form.headers.get('location') === '/contact?sent=1#sent',
    'POST /api/contact (form) → 303',
  );

  const auth = { authorization: `Bearer ${adminKey}` };
  const leads = await (await fetch(`${base}/api/v1/leads`, { headers: auth })).json();
  ok(leads.items?.length === 2, `2 leads stored (got ${leads.items?.length})`);

  // n8n is down: the outbox must keep the events and record a failed attempt.
  let attempted = false;
  for (let i = 0; i < 30 && !attempted; i++) {
    const pending = await (
      await fetch(`${base}/api/v1/outbox?status=pending`, { headers: auth })
    ).json();
    attempted = pending.items?.some(
      (/** @type {{attempts: number, last_error: string | null}} */ r) =>
        r.attempts >= 1 && r.last_error,
    );
    if (!attempted) await sleep(500);
  }
  ok(attempted, 'outbox retained the events and recorded the failed delivery');
  const status = await (await fetch(`${base}/api/v1/status`, { headers: auth })).json();
  ok(
    status.outbox?.pending === 2 && status.outbox?.dead === 0,
    '/api/v1/status shows 2 pending, 0 dead',
  );
}

/** @param {string} base */
async function checkContactHoneypot(base) {
  const res = await fetch(`${base}/api/contact`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Smoke',
      email: 'smoke@example.test',
      message: 'post-deploy smoke',
      website: 'x',
    }),
  });
  ok(res.status === 202, 'POST /api/contact (honeypot, nothing stored) → 202');
}

const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

main().catch((err) => {
  console.error('smoke:', err);
  process.exit(1);
});
