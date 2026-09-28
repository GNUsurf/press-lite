/**
 * First-boot import: `content/` and `site.config.js` become version 1 of
 * everything in the database, attributed to the key name `seed`. Runs only
 * when the content tables are empty, so a second boot imports nothing.
 * Seeded posts don't emit `post.published` events; n8n didn't ask for them.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadPosts, POSTS_DIR, IMAGES_DIR } from './posts.js';
import { IMAGE_EXTENSIONS } from './rules.js';
import { site as defaultSite } from '../../site.config.js';
import { importAssetFile } from '../services/assets.js';
import { createPost, publishPost } from '../services/posts.js';
import { getSiteCopy, setSiteCopy } from '../services/site-copy.js';

export const SEED_KEY = 'seed';

/**
 * @param {import('../db/index.js').Db} db
 * @param {object} options
 * @param {string} options.dataDir
 * @param {string} [options.postsDir]
 * @param {string} [options.imagesDir]
 * @param {import('../../site.config.js').SiteConfig} [options.site]
 * @param {import('../lib/time.js').Clock} [options.clock]
 * @returns {{ posts: number, assets: number, siteCopy: number }}
 */
export function seedIfEmpty(
  db,
  { dataDir, postsDir = POSTS_DIR, imagesDir = IMAGES_DIR, site = defaultSite, clock },
) {
  const counts = { posts: 0, assets: 0, siteCopy: 0 };

  if (!getSiteCopy(db)) {
    setSiteCopy(db, site, SEED_KEY, clock);
    counts.siteCopy = 1;
  }

  const havePosts =
    /** @type {{ n: number }} */ (db.prepare('SELECT COUNT(*) AS n FROM posts').get()).n > 0;
  if (havePosts) return counts;

  /** @type {Map<string, import('../services/assets.js').Asset>} */
  const assetsByName = new Map();
  if (fs.existsSync(imagesDir)) {
    for (const name of fs.readdirSync(imagesDir).sort()) {
      if (name.startsWith('.') || !IMAGE_EXTENSIONS.includes(path.extname(name).toLowerCase()))
        continue;
      const { asset, created } = importAssetFile(
        db,
        dataDir,
        path.join(imagesDir, name),
        SEED_KEY,
        clock,
      );
      assetsByName.set(name, asset);
      if (created) counts.assets++;
    }
  }

  for (const post of loadPosts({ postsDir, imagesDir, includeDrafts: true })) {
    const cover = post.cover ? assetsByName.get(path.basename(post.cover)) : undefined;
    const { post: row } = createPost(
      db,
      {
        slug: post.slug,
        title: post.title,
        description: post.description,
        body: post.markdown,
        tags: post.tags,
        date: post.date,
        coverAssetId: cover?.id ?? null,
      },
      SEED_KEY,
      { clock },
    );
    if (!post.draft) publishPost(db, row.id, SEED_KEY, { clock, emitEvent: false });
    counts.posts++;
  }

  return counts;
}
