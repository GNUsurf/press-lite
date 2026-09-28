#!/usr/bin/env node
/**
 * `make check-content`: every seed post validates, slugs are unique, images
 * are within budget, and the hero video is under 4 MB. Content written
 * through the API is validated by the API; this covers what ships in the
 * repo.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  POSTS_DIR,
  IMAGES_DIR,
  MAX_IMAGE_BYTES,
  IMAGE_EXTENSIONS,
  parseFrontmatter,
  validateFrontmatter,
} from '../src/content/posts.js';
import { imageSize } from '../src/lib/image-size.js';

const MAX_HERO_BYTES = 4 * 1024 * 1024;

/**
 * @param {{ postsDir?: string, imagesDir?: string, publicDir?: string }} [options]
 * @returns {string[]} problems; empty means pass
 */
export function checkContent({
  postsDir = POSTS_DIR,
  imagesDir = IMAGES_DIR,
  publicDir = 'public',
} = {}) {
  /** @type {string[]} */
  const problems = [];

  const slugs = new Map();
  for (const file of listFiles(postsDir, '.md')) {
    const name = path.basename(file);
    try {
      const { data, body } = parseFrontmatter(fs.readFileSync(file, 'utf8'));
      for (const e of validateFrontmatter(data, { file, imagesDir, body })) {
        problems.push(`${name}: ${e}`);
      }
      if (typeof data.slug === 'string') {
        if (slugs.has(data.slug))
          problems.push(`${name}: duplicate slug "${data.slug}" (also ${slugs.get(data.slug)})`);
        slugs.set(data.slug, name);
      }
    } catch (err) {
      problems.push(`${name}: ${/** @type {Error} */ (err).message}`);
    }
  }

  for (const file of listFiles(imagesDir)) {
    const name = path.basename(file);
    const ext = path.extname(name).toLowerCase();
    if (!IMAGE_EXTENSIONS.includes(ext))
      problems.push(`images/${name}: only ${IMAGE_EXTENSIONS.join(', ')} allowed`);
    else if (!imageSize(file)) problems.push(`images/${name}: not a readable image`);
    if (fs.statSync(file).size > MAX_IMAGE_BYTES) problems.push(`images/${name}: over 300 KB`);
  }

  const hero = path.join(publicDir, 'hero.mp4');
  if (fs.existsSync(hero) && fs.statSync(hero).size > MAX_HERO_BYTES) {
    problems.push('public/hero.mp4: over 4 MB');
  }

  return problems;
}

/** @param {string} dir @param {string} [ext] */
function listFiles(dir, ext) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => !f.startsWith('.') && (!ext || f.endsWith(ext)))
    .sort()
    .map((f) => path.join(dir, f));
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const problems = checkContent();
  if (problems.length) {
    console.error(`check-content: ${problems.length} problem(s)\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  console.log('check-content: ok');
}
