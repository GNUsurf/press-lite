/**
 * Shared test fixtures. No sockets are opened: the app is exercised with
 * `app.inject()` and n8n is a fake `fetch`.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../src/lib/env.js';
import { sourceFromFiles } from '../src/build/source.js';
import { createRenderer, nullRenderer } from '../src/build/renderer.js';
import { sha256 } from '../src/lib/crypto.js';
import { openDatabase } from '../src/db/index.js';
import { buildApp } from '../src/server.js';

export const KEYS = {
  admin: 'test-admin-key-000000000000000000000000',
  reader: 'test-reader-key-00000000000000000000000',
  writer: 'test-writer-key-00000000000000000000000',
  publisher: 'test-publisher-key-00000000000000000000',
};

export const API_KEYS = [
  `admin:admin:${sha256(KEYS.admin)}`,
  `reader:leads:read,content:read:${sha256(KEYS.reader)}`,
  `writer:leads:read,leads:write,content:read,content:write:${sha256(KEYS.writer)}`,
  `publisher:content:read,content:write,content:publish:${sha256(KEYS.publisher)}`,
].join(';');

export const N8N = {
  url: 'http://n8n.test/webhook/site',
  token: 'test-webhook-token',
  secret: 'test-signing-secret',
};

/** @param {Partial<NodeJS.ProcessEnv>} [overrides] */
export function envVars(overrides = {}) {
  return {
    PORT: '3000',
    DATA_DIR: tmpDir(),
    SITE_URL: 'https://example.test',
    N8N_WEBHOOK_URL: N8N.url,
    N8N_WEBHOOK_TOKEN: N8N.token,
    N8N_SIGNING_SECRET: N8N.secret,
    API_KEYS,
    ...overrides,
  };
}

export function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'site-test-'));
}

export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
export const FIXTURE_POSTS = path.join(FIXTURES, 'content/posts');
export const FIXTURE_IMAGES = path.join(FIXTURES, 'content/images');

/** The fixture posts as a build source. */
export function fixtureSource() {
  return sourceFromFiles({ postsDir: FIXTURE_POSTS, imagesDir: FIXTURE_IMAGES });
}

/** A temp dist dir holding the CSS the build expects. */
export function emptyDist() {
  const distDir = tmpDir();
  fs.mkdirSync(path.join(distDir, 'assets'));
  fs.writeFileSync(path.join(distDir, 'assets/site.css'), 'body{margin:0}');
  return distDir;
}

/** A clock tests can move. @param {number} [start] */
export function fakeClock(start = Date.parse('2026-01-01T00:00:00.000Z')) {
  let now = start;
  return {
    now: () => now,
    /** @param {number} ms */
    advance(ms) {
      now += ms;
    },
    set(/** @type {number} */ ms) {
      now = ms;
    },
  };
}

/**
 * @param {{ clock?: ReturnType<typeof fakeClock>, memory?: boolean, render?: boolean }} [options]
 *   `render: true` gives the app a real renderer over a file DB and a temp
 *   dist (with CSS), so publish/delete tests can see pages and redirects.
 */
export async function makeApp({ clock = fakeClock(), memory = true, render = false } = {}) {
  const env = loadEnv(envVars());
  const db = openDatabase(env.dataDir, { memory: memory && !render });
  const distDir = render ? emptyDist() : path.join(env.dataDir, 'nodist');
  const log = fakeLog();
  const renderer = render ? createRenderer({ db, env, log, distDir, delayMs: 10 }) : nullRenderer();
  const app = await buildApp({ env, db, clock, logger: false, distDir, renderer });
  if (render) renderer.renderNow(); // as main() does at boot
  await app.ready();
  return {
    app,
    db,
    env,
    clock,
    distDir,
    renderer,
    log,
    async close() {
      renderer.stop();
      await app.close();
      db.close();
    },
  };
}

/** @param {string} key */
export function bearer(key) {
  return { authorization: `Bearer ${key}` };
}

/**
 * A fake n8n: a `fetch` that records requests and answers per `mode`.
 * @param {'ok' | 'error500' | 'error400' | 'hang' | 'network'} [mode]
 */
export function fakeN8n(mode = 'ok') {
  /** @type {{ url: string, headers: Record<string, string>, body: string }[]} */
  const requests = [];
  const fake = {
    mode,
    requests,
    /** @type {(() => void) | null} called after the request is recorded, before responding */
    beforeResponse: null,
    /**
     * @param {string | URL | Request} url
     * @param {RequestInit} [init]
     * @returns {Promise<Response>}
     */
    async fetch(url, init) {
      const headers = /** @type {Record<string, string>} */ (init?.headers ?? {});
      requests.push({ url: String(url), headers, body: String(init?.body) });
      fake.beforeResponse?.();
      switch (fake.mode) {
        case 'ok':
          return new Response('{"ok":true}', { status: 200 });
        case 'error500':
          return new Response('boom', { status: 500 });
        case 'error400':
          return new Response('bad', { status: 400 });
        case 'network':
          throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
        case 'hang':
          return new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
          });
      }
      throw new Error(`unknown mode ${fake.mode}`);
    },
  };
  return fake;
}

/** A logger that records instead of printing. */
export function fakeLog() {
  /** @type {{ level: string, args: unknown[] }[]} */
  const entries = [];
  const make =
    (/** @type {string} */ level) =>
    (/** @type {unknown[]} */ ...args) => {
      entries.push({ level, args });
    };
  return { entries, info: make('info'), warn: make('warn'), error: make('error') };
}
