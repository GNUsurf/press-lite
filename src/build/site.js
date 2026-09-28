/**
 * Static site build: renders every page and post, copies assets, and writes
 * sitemap, robots and RSS. Content comes from a `BuildSource` (files at image
 * build time, the database at run time; see ./source.js). `scripts/build.js`
 * is the CLI; `./renderer.js` drives it inside the server.
 *
 * The output is written to a staging directory (`<dist>.next`) and renamed
 * into place, so a visitor during a render never sees a half-written page.
 * A failed render leaves the previous `dist/` untouched.
 *
 * The CSS must already exist at dist/assets/site.css (`make css`); this
 * step only hashes and links it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { html } from '../lib/html.js';
import { sha256 } from '../lib/crypto.js';
import { absoluteUrl } from '../lib/urls.js';
import { imageSize } from '../lib/image-size.js';
import { excerpt } from '../lib/markdown.js';
import * as home from '../templates/pages/home.js';
import * as services from '../templates/pages/services.js';
import * as work from '../templates/pages/work.js';
import * as blog from '../templates/pages/blog.js';
import * as about from '../templates/pages/about.js';
import * as contact from '../templates/pages/contact.js';
import * as privacy from '../templates/pages/privacy.js';
import * as notFound from '../templates/pages/not-found.js';
import { renderPost } from '../templates/pages/post.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const DIST_DIR = path.join(ROOT, 'dist');
export const PUBLIC_DIR = path.join(ROOT, 'public');
const CLIENT_JS = path.join(ROOT, 'src/client/site.js');
const CSS_NAME = 'assets/site.css';

const PAGES = [home, services, work, blog, about, contact, privacy, notFound];
/** Pages that belong in the sitemap (indexable, not error pages). */
const SITEMAP_PATHS = new Set(['/', '/services', '/work', '/blog', '/about', '/contact']);

/**
 * @typedef {object} BuildOptions
 * @property {string} siteUrl
 * @property {import('./source.js').BuildSource} source
 * @property {string} [distDir]
 * @property {string} [publicDir]
 * @property {boolean} [dev]        unhashed asset names, for `make dev`
 * @property {string} [builtAt]
 */

/**
 * @param {BuildOptions} options
 * @returns {{ pages: string[], siteUrl: string }}
 */
export function buildSite({
  siteUrl,
  source,
  distDir = DIST_DIR,
  publicDir = PUBLIC_DIR,
  dev = false,
  builtAt = new Date().toISOString(),
}) {
  siteUrl = new URL(siteUrl).origin;
  const cssPath = path.join(distDir, CSS_NAME);
  if (!fs.existsSync(cssPath)) {
    throw new Error(`${CSS_NAME} not found in ${distDir}; run \`make css\` first`);
  }

  // Everything below writes to `out`; the live directory changes only at the swap.
  const out = `${distDir}.next`;
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const css = publishAsset(out, cssPath, 'site', 'css', dev);
  writeFile(path.join(out, CSS_NAME), fs.readFileSync(cssPath)); // keep the unhashed one for `make dev`
  copyDir(publicDir, out);
  if (source.imagesDir) copyDir(source.imagesDir, path.join(out, 'images'));

  const js = publishAsset(out, CLIENT_JS, 'site', 'js', dev);
  const poster = imageSize(path.join(publicDir, 'hero-poster.jpg'));
  if (!poster) throw new Error('public/hero-poster.jpg is missing or unreadable');

  /** @type {import('./context.js').BuildContext} */
  const ctx = {
    site: source.site,
    siteUrl,
    posts: source.posts,
    assets: {
      css,
      js,
      heroVideo: fs.existsSync(path.join(publicDir, 'hero.mp4')),
      heroPoster: poster,
    },
    builtAt,
  };

  /** @type {[string, () => import('../lib/html.js').Raw][]} */
  const renders = [
    ...PAGES.map(
      (page) =>
        /** @type {[string, () => import('../lib/html.js').Raw]} */ ([
          page.path,
          () => page.render(ctx),
        ]),
    ),
    ...ctx.posts.map(
      (post) =>
        /** @type {[string, () => import('../lib/html.js').Raw]} */ ([
          `/blog/${post.slug}`,
          () => renderPost(ctx, post),
        ]),
    ),
  ];
  const pages = renders.map(([p]) => p);
  for (const [pagePath, render] of renders) {
    writeFile(path.join(out, outputFile(pagePath, pages)), render().toString());
  }

  writeFile(path.join(out, 'sitemap.xml'), sitemap(ctx, pages));
  writeFile(path.join(out, 'robots.txt'), robots(ctx));
  writeFile(path.join(out, 'feed.xml'), feed(ctx));
  writeFile(
    path.join(out, 'build.json'),
    JSON.stringify({ siteUrl, builtAt, dev, pages, assets: { css, js } }, null, 2),
  );

  swapIn(out, distDir);
  return { pages, siteUrl };
}

/**
 * The SITE_URL a dist was built for, or null when there is no build.
 * @param {string} [distDir]
 */
export function builtFor(distDir = DIST_DIR) {
  const file = path.join(distDir, 'build.json');
  if (!fs.existsSync(file)) return null;
  try {
    const { siteUrl } = /** @type {{ siteUrl?: string }} */ (
      JSON.parse(fs.readFileSync(file, 'utf8'))
    );
    return siteUrl ?? null;
  } catch {
    return null;
  }
}

/**
 * @param {import('./context.js').BuildContext} ctx
 * @param {string[]} pages
 */
function sitemap(ctx, pages) {
  const urls = pages.filter((p) => SITEMAP_PATHS.has(p) || p.startsWith('/blog/'));
  const lastmod = ctx.builtAt.slice(0, 10);
  const modified = (/** @type {string} */ p) =>
    ctx.posts.find((post) => `/blog/${post.slug}` === p)?.date ?? lastmod;
  return html`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(
  (
    p,
  ) => html`  <url><loc>${absoluteUrl(ctx.siteUrl, p)}</loc><lastmod>${modified(p)}</lastmod></url>
`,
)}</urlset>
`.toString();
}

/** @param {import('./context.js').BuildContext} ctx */
function robots(ctx) {
  return `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /preview/\n\nSitemap: ${absoluteUrl(ctx.siteUrl, '/sitemap.xml')}\n`;
}

/** @param {import('./context.js').BuildContext} ctx */
function feed(ctx) {
  const items = ctx.posts.slice(0, 20).map((post) => {
    const url = absoluteUrl(ctx.siteUrl, `/blog/${post.slug}`);
    return html`    <item>
      <title>${post.title}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <pubDate>${new Date(`${post.date}T00:00:00Z`).toUTCString()}</pubDate>
      <description>${post.description || excerpt(post.markdown)}</description>
    </item>
`;
  });
  return html`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${ctx.site.name}</title>
    <link>${ctx.siteUrl}</link>
    <description>${ctx.site.description}</description>
    <language>en</language>
    <lastBuildDate>${new Date(ctx.builtAt).toUTCString()}</lastBuildDate>
    <atom:link href="${absoluteUrl(ctx.siteUrl, '/feed.xml')}" rel="self" type="application/rss+xml"/>
${items}  </channel>
</rss>
`.toString();
}

/**
 * Copy `source` to <out>/assets/<name>.<hash>.<ext> (or unhashed in dev) and
 * return its public path.
 * @param {string} out @param {string} source @param {string} name @param {string} ext @param {boolean} dev
 */
function publishAsset(out, source, name, ext, dev) {
  const content = fs.readFileSync(source);
  const file = dev ? `${name}.${ext}` : `${name}.${sha256(content).slice(0, 12)}.${ext}`;
  writeFile(path.join(out, 'assets', file), content);
  return `/assets/${file}`;
}

/**
 * Replace `distDir` with the staged `out` in two renames. A request that
 * lands between them gets a 404 for a few microseconds; none gets a partial
 * page. The previous build is removed afterwards.
 * @param {string} out @param {string} distDir
 */
function swapIn(out, distDir) {
  const previous = `${distDir}.prev`;
  fs.rmSync(previous, { recursive: true, force: true });
  if (fs.existsSync(distDir)) fs.renameSync(distDir, previous);
  fs.renameSync(out, distDir);
  fs.rmSync(previous, { recursive: true, force: true });
}

/** @param {string} from @param {string} to */
function copyDir(from, to) {
  if (!fs.existsSync(from)) return;
  fs.cpSync(from, to, { recursive: true, filter: (src) => !path.basename(src).startsWith('.') });
}

/**
 * `/` → index.html; `/x` → x.html; but a page with children (`/blog` above
 * `/blog/<slug>`) → blog/index.html, so the static server, which sees a
 * `blog/` directory, still serves the list at `/blog`.
 * @param {string} pagePath @param {string[]} allPages
 */
function outputFile(pagePath, allPages) {
  if (pagePath === '/') return 'index.html';
  const slug = pagePath.slice(1);
  const hasChildren = allPages.some((p) => p.startsWith(`${pagePath}/`));
  return hasChildren ? `${slug}/index.html` : `${slug}.html`;
}

/** @param {string} file @param {string | Buffer} content */
function writeFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}
