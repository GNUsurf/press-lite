/**
 * Where a build gets its content. Two sources, one shape:
 *
 * - files: `content/` + `site.config.js`. Used by `scripts/build.js` at image
 *   build time (there is no database yet) and by tests.
 * - database: published posts (live version) + site copy. Used by the
 *   running server, at boot and after every content change.
 */
import { loadPosts, sortPosts, POSTS_DIR, IMAGES_DIR } from '../content/posts.js';
import { site as defaultSite } from '../../site.config.js';
import { renderMarkdown } from '../lib/markdown.js';
import { listLivePosts } from '../services/posts.js';
import { getAsset, assetUrl, assetsDir } from '../services/assets.js';
import { getSiteCopy } from '../services/site-copy.js';

/**
 * @typedef {object} BuildSource
 * @property {import('../../site.config.js').SiteConfig} site
 * @property {import('../content/posts.js').Post[]} posts   published, newest first
 * @property {string | null} imagesDir   copied to dist/images when set (file mode); null when
 *                                       the server serves /images/ from the data dir itself
 */

/**
 * @param {{ postsDir?: string, imagesDir?: string, site?: import('../../site.config.js').SiteConfig }} [options]
 * @returns {BuildSource}
 */
export function sourceFromFiles({
  postsDir = POSTS_DIR,
  imagesDir = IMAGES_DIR,
  site = defaultSite,
} = {}) {
  return { site, posts: loadPosts({ postsDir, imagesDir }), imagesDir };
}

/**
 * @param {import('../db/index.js').Db} db
 * @param {string} dataDir
 * @returns {BuildSource}
 */
export function sourceFromDb(db, dataDir) {
  assetsDir(dataDir);
  const site = getSiteCopy(db)?.data ?? defaultSite;
  const posts = listLivePosts(db).map(({ post, live }) => {
    const cover = live.cover_asset_id ? getAsset(db, live.cover_asset_id) : undefined;
    return /** @type {import('../content/posts.js').Post} */ ({
      title: live.title,
      description: live.description,
      date: live.date,
      slug: post.slug,
      tags: JSON.parse(live.tags),
      draft: false,
      markdown: live.body,
      html: renderMarkdown(live.body),
      coverUrl: cover ? assetUrl(cover) : null,
      coverSize: cover ? { width: cover.width, height: cover.height } : null,
    });
  });
  return { site, posts: sortPosts(posts), imagesDir: null };
}
