#!/usr/bin/env node
/**
 * `make build`: render the site into dist/ from the seed files (`content/`
 * and `site.config.js`). This is what the Docker image ships with and what
 * CI validates; the running server re-renders from the database at boot.
 * Needs SITE_URL (the canonical origin); pass --dev for unhashed asset names
 * during `make dev`.
 */
import { buildSite } from '../src/build/site.js';
import { sourceFromFiles } from '../src/build/source.js';

const siteUrl = process.env.SITE_URL;
if (!siteUrl) {
  console.error('build: SITE_URL is required (the canonical origin, e.g. https://example.com)');
  process.exit(1);
}

const { pages } = buildSite({
  siteUrl,
  source: sourceFromFiles(),
  dev: process.argv.includes('--dev'),
});
console.log(`build: ${pages.length} pages for ${siteUrl}`);
