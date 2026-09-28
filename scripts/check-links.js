#!/usr/bin/env node
/**
 * `make check-links`: every internal href/src/action/poster in dist/ resolves
 * to a file, and every `#fragment` points at an id that exists on the target
 * page. With --external, http(s) links are fetched too (nightly job).
 */
import fs from 'node:fs';
import path from 'node:path';
import { DIST_DIR } from '../src/build/site.js';

const ATTR = /\b(?:href|src|action|poster)="([^"]*)"/g;
const ID = /\bid="([^"]+)"/g;
/** Served by the API, not files in dist. */
const DYNAMIC_PREFIXES = ['/api/'];

/**
 * @param {{ distDir?: string, external?: boolean }} [options]
 * @returns {Promise<string[]>} problems
 */
export async function checkLinks({ distDir = DIST_DIR, external = false } = {}) {
  /** @type {string[]} */
  const problems = [];
  const pages = walk(distDir).filter((f) => f.endsWith('.html'));
  const ids = new Map(
    pages.map((f) => [f, new Set([...fs.readFileSync(f, 'utf8').matchAll(ID)].map((m) => m[1]))]),
  );
  /** @type {Set<string>} */
  const externals = new Set();

  for (const page of pages) {
    const source = fs.readFileSync(page, 'utf8');
    for (const [, rawUrl] of source.matchAll(ATTR)) {
      const url = rawUrl.replace(/&amp;/g, '&');
      const rel = path.relative(distDir, page);
      if (/^(mailto:|tel:|data:)/.test(url) || url === '') continue;
      if (/^https?:\/\//.test(url)) {
        externals.add(url);
        continue;
      }
      if (url.startsWith('//')) {
        problems.push(`${rel}: protocol-relative URL ${url}`);
        continue;
      }

      const [pathPart, fragment] = url.split('#');
      const target = pathPart.split('?')[0];
      let targetFile = page;
      if (target) {
        if (!target.startsWith('/')) {
          problems.push(`${rel}: relative URL "${url}" (use a root-relative path)`);
          continue;
        }
        if (DYNAMIC_PREFIXES.some((p) => target.startsWith(p))) continue;
        const resolved = resolveFile(distDir, target);
        if (!resolved) {
          problems.push(`${rel}: ${target} does not resolve`);
          continue;
        }
        targetFile = resolved;
      }
      if (fragment && targetFile.endsWith('.html') && !ids.get(targetFile)?.has(fragment)) {
        problems.push(`${rel}: #${fragment} not found in ${path.relative(distDir, targetFile)}`);
      }
    }
  }

  if (external) {
    for (const url of externals) {
      if (/\[[^\]]*\]/.test(url)) continue; // placeholder handles in site.config.js
      try {
        const res = await fetch(url, {
          method: 'HEAD',
          redirect: 'follow',
          signal: AbortSignal.timeout(10_000),
        });
        if (res.status >= 400) problems.push(`external ${url}: HTTP ${res.status}`);
      } catch (err) {
        problems.push(`external ${url}: ${/** @type {Error} */ (err).message}`);
      }
    }
  }

  return problems;
}

/**
 * `/x` → dist/x, dist/x.html or dist/x/index.html; `/` → dist/index.html.
 * @param {string} distDir @param {string} urlPath
 */
function resolveFile(distDir, urlPath) {
  const decoded = decodeURIComponent(urlPath);
  const base = path.join(distDir, decoded);
  if (!base.startsWith(distDir)) return null;
  for (const candidate of [base, `${base}.html`, path.join(base, 'index.html')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** @param {string} dir @returns {string[]} */
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const abs = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(abs) : [abs];
  });
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const problems = await checkLinks({ external: process.argv.includes('--external') });
  if (problems.length) {
    console.error(`check-links: ${problems.length} problem(s)\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  console.log('check-links: ok');
}
