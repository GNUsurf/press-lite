/**
 * Renders the static site from the database inside the running server: once
 * at boot, then after every content change, debounced so a burst of API
 * calls costs one render. Also owns the redirect table the server consults
 * before serving a page.
 *
 * `buildSite()` is synchronous and takes tens of milliseconds at this page
 * count, so renders serialise trivially; a change arriving mid-render simply
 * schedules the next one.
 */
import { buildSite, DIST_DIR } from './site.js';
import { sourceFromDb } from './source.js';

/**
 * @typedef {object} Renderer
 * @property {() => { pages: string[] } | null} renderNow   render synchronously; null on failure (logged)
 * @property {() => void} schedule                          render after the debounce window
 * @property {(path: string) => string | null} redirectFor  301 target for a request path, if any
 * @property {() => void} stop
 */

/**
 * @param {object} options
 * @param {import('../db/index.js').Db} options.db
 * @param {Pick<import('../lib/env.js').Env, 'siteUrl' | 'dataDir'>} options.env
 * @param {{ info: (obj: object, msg: string) => void, error: (obj: object, msg: string) => void }} options.log
 * @param {string} [options.distDir]
 * @param {number} [options.delayMs]
 * @returns {Renderer}
 */
export function createRenderer({ db, env, log, distDir = DIST_DIR, delayMs = 1000 }) {
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null;
  /** @type {Map<string, string>} */
  let redirects = loadRedirects(db);

  function renderNow() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    try {
      const started = Date.now();
      const { pages } = buildSite({
        siteUrl: env.siteUrl,
        source: sourceFromDb(db, env.dataDir),
        distDir,
      });
      redirects = loadRedirects(db);
      log.info({ pages: pages.length, ms: Date.now() - started }, 'rendered static site');
      return { pages };
    } catch (err) {
      // The API keeps working; the previous dist/ keeps serving.
      log.error({ err }, 'static site render failed');
      return null;
    }
  }

  return {
    renderNow,
    schedule() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        renderNow();
      }, delayMs);
    },
    redirectFor(path) {
      return redirects.get(path) ?? null;
    },
    stop() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

/** A renderer that does nothing, for tests and tools that don't serve pages. @returns {Renderer} */
export function nullRenderer() {
  return { renderNow: () => null, schedule() {}, redirectFor: () => null, stop() {} };
}

/** @param {import('../db/index.js').Db} db */
function loadRedirects(db) {
  const rows = /** @type {{ from_path: string, to_path: string }[]} */ (
    db.prepare('SELECT from_path, to_path FROM redirects').all()
  );
  return new Map(rows.map((r) => [r.from_path, r.to_path]));
}
