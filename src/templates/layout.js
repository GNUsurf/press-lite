/**
 * The document shell. Pages pass their meta and body; the layout adds the
 * nav, footer, hashed asset links and the single deferred script.
 */
import { html } from '../lib/html.js';
import { metaTags } from './seo.js';
import { nav, footer } from './components.js';

/**
 * @param {import('../build/context.js').BuildContext} ctx
 * @param {import('./seo.js').PageMeta} page
 * @param {import('../lib/html.js').Raw} body
 * @param {{ hero?: boolean }} [options]  hero pages start at the top edge; others pad below the nav
 */
export function layout(ctx, page, body, { hero = false } = {}) {
  return html`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    ${metaTags(ctx, page)}
    <link rel="icon" href="/favicon.svg" type="image/svg+xml">
    <link rel="alternate" type="application/rss+xml" title="${ctx.site.name}" href="/feed.xml">
    <link rel="stylesheet" href="${ctx.assets.css}">
    <script src="${ctx.assets.js}" defer></script>
  </head>
  <body>
    <a href="#main" class="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-ink">Skip to content</a>
    ${nav(ctx, page.path)}
    <main id="main" class="${hero ? '' : 'pt-nav'}">
      ${body}
    </main>
    ${footer(ctx)}
  </body>
</html>
`;
}
