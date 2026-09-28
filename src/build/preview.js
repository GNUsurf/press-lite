/**
 * Render one post's head version on demand, for `/preview/<token>`. Uses
 * the same templates and site copy as the static build, plus the asset
 * paths recorded in dist/build.json, so a preview looks exactly like the
 * page will once published.
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
 * @param {object} options
 * @param {import('../db/index.js').Db} options.db
 * @param {Pick<import('../lib/env.js').Env, 'siteUrl' | 'dataDir'>} options.env
 * @param {string} options.token
 * @param {string} [options.distDir]
 * @param {string} [options.publicDir]
 * @returns {{ html: string, slug: string } | null}  null when there is no such draft or no build yet
 */
export function renderPreview({ db, env, token, distDir = DIST_DIR, publicDir = PUBLIC_DIR }) {
  const d = getPostByPreviewToken(db, token);
  if (!d) return null;

  const build = readBuild(distDir);
  const poster = imageSize(path.join(publicDir, 'hero-poster.jpg'));
  if (!build || !poster) return null;

  /** @type {import('./context.js').BuildContext} */
  const ctx = {
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
  const post = postFromVersion(db, d.post, d.head);
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
