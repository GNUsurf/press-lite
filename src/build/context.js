/**
 * What every template receives. Built once per `buildSite()` run.
 *
 * @typedef {object} BuildContext
 * @property {import('../../site.config.js').SiteConfig} site
 * @property {string} siteUrl            canonical origin, no trailing slash
 * @property {{ css: string, js: string, heroVideo: boolean, heroPoster: { width: number, height: number } }} assets
 *   `css`/`js` are public paths (content-hashed in production builds)
 * @property {import('../content/posts.js').Post[]} posts   published, newest first
 * @property {string} builtAt            ISO timestamp
 */

export {};
