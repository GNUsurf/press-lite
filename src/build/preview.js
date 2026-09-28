/**
 * Pages rendered at request time (post previews, the API docs) share the
 * static build's templates, site copy and asset paths, so they look exactly
 * like the built pages. `runtimeContext()` assembles that from the database
 * and dist/build.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { imageSize } from '../lib/image-size.js';
import { getPostByPreviewToken } from '../services/posts.js';
import { getSiteCopy } from '../services/site-copy.js';
import { site as defaultSite } from '../../site.config.js';
import { renderPost } from '../templates/pages/post.js';
import { DIST_DIR, PUBLIC_DIR } from './site.js';
import { postFromVersion } from './source.js';

/**
 * @typedef {object} RuntimeOptions
 * @property {import('../db/index.js').Db} db
 * @property {Pick<import('../lib/env.js').Env, 'siteUrl' | 'dataDir'>} env
 * @property {string} [distDir]
 * @property {string} [publicDir]
 */

/**
 * @param {RuntimeOptions} options
 * @returns {import('./context.js').BuildContext | null}  null before the first render
 */
export function runtimeContext({ db, env, distDir = DIST_DIR, publicDir = PUBLIC_DIR }) {
  const build = readBuild(distDir);
  const poster = imageSize(path.join(publicDir, 'hero-poster.jpg'));
  if (!build || !poster) return null;
  return {
    site: getSiteCopy(db)?.data ?? defaultSite,
    siteUrl: env.siteUrl,
    posts: [],
    assets: {
      css: build.assets.css,
      js: build.assets.js,
      heroVideo: fs.existsSync(path.join(publicDir, 'hero.mp4')),
      heroPoster: poster,
    },
    builtAt: new Date().toISOString(),
  };
}

/**
 * Render one post's head version on demand, for `/preview/<token>`.
 * @param {RuntimeOptions & { token: string }} options
 * @returns {{ html: string, slug: string } | null}  null when there is no such draft or no build yet
 */
export function renderPreview({ token, ...options }) {
  const d = getPostByPreviewToken(options.db, token);
  const ctx = d && runtimeContext(options);
  if (!d || !ctx) return null;
  const post = postFromVersion(options.db, d.post, d.head);
  return { html: renderPost(ctx, post).toString(), slug: post.slug };
}

/** @param {string} distDir */
function readBuild(distDir) {
  try {
    const build = JSON.parse(fs.readFileSync(path.join(distDir, 'build.json'), 'utf8'));
    return build?.assets?.css && build?.assets?.js
      ? /** @type {{ assets: { css: string, js: string } }} */ (build)
      : null;
  } catch {
    return null;
  }
}
