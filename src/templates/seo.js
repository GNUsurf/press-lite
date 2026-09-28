/**
 * <head> metadata and JSON-LD. Every page gets a unique title, description,
 * canonical URL, Open Graph and Twitter tags; the home page adds
 * ProfessionalService and posts add BlogPosting.
 */
import { html, raw } from '../lib/html.js';
import { absoluteUrl } from '../lib/urls.js';

/**
 * @typedef {object} PageMeta
 * @property {string} title
 * @property {string} description
 * @property {string} path          '/', '/blog/slug', ...
 * @property {string} [ogImage]     absolute URL; defaults to /og-default.png
 * @property {'website' | 'article'} [ogType]
 * @property {object} [jsonLd]
 * @property {boolean} [noindex]
 */

/**
 * @param {import('../build/context.js').BuildContext} ctx
 * @param {PageMeta} page
 */
export function metaTags(ctx, page) {
  const canonical = absoluteUrl(ctx.siteUrl, page.path);
  const image = page.ogImage ?? absoluteUrl(ctx.siteUrl, '/og-default.png');
  const fullTitle =
    page.path === '/'
      ? `${ctx.site.name} — ${ctx.site.tagline}`
      : `${page.title} — ${ctx.site.name}`;
  return html`
    <title>${fullTitle}</title>
    <meta name="description" content="${page.description}">
    <link rel="canonical" href="${canonical}">
    ${page.noindex ? html`<meta name="robots" content="noindex">` : null}
    <meta property="og:type" content="${page.ogType ?? 'website'}">
    <meta property="og:site_name" content="${ctx.site.name}">
    <meta property="og:title" content="${page.title}">
    <meta property="og:description" content="${page.description}">
    <meta property="og:url" content="${canonical}">
    <meta property="og:image" content="${image}">
    <meta property="og:locale" content="${ctx.site.locale}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${page.title}">
    <meta name="twitter:description" content="${page.description}">
    <meta name="twitter:image" content="${image}">
    ${page.jsonLd ? jsonLd(page.jsonLd) : null}
  `;
}

/**
 * JSON-LD is data, not executable, so CSP's script-src doesn't apply. `<` is
 * escaped so a `</script>` inside a string can't break out of the block.
 * @param {object} data
 */
export function jsonLd(data) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return html`<script type="application/ld+json">${raw(json)}</script>`;
}

/** @param {import('../build/context.js').BuildContext} ctx */
export function professionalService(ctx) {
  const { site, siteUrl } = ctx;
  return {
    '@context': 'https://schema.org',
    '@type': 'ProfessionalService',
    name: site.name,
    description: site.description,
    url: siteUrl,
    email: site.contact.email,
    sameAs: Object.values(site.links),
    makesOffer: site.services.map((s) => ({
      '@type': 'Offer',
      itemOffered: { '@type': 'Service', name: s.title, description: s.summary },
    })),
  };
}

/**
 * @param {import('../build/context.js').BuildContext} ctx
 * @param {import('../content/posts.js').Post} post
 */
export function blogPosting(ctx, post) {
  const url = absoluteUrl(ctx.siteUrl, `/blog/${post.slug}`);
  return {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    keywords: post.tags.join(', '),
    url,
    mainEntityOfPage: url,
    image: post.coverUrl
      ? absoluteUrl(ctx.siteUrl, post.coverUrl)
      : absoluteUrl(ctx.siteUrl, '/og-default.png'),
    author: { '@type': 'Organization', name: ctx.site.name, url: ctx.siteUrl },
    publisher: { '@type': 'Organization', name: ctx.site.name, url: ctx.siteUrl },
  };
}
