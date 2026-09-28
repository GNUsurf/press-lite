/**
 * Markdown → HTML for blog posts. `html: false` means raw HTML in a post is
 * escaped, and markdown-it's default `validateLink` (kept) refuses
 * `javascript:`, `vbscript:` and `data:` URLs. The output is the only thing
 * that goes through `raw()`.
 */
import MarkdownIt from 'markdown-it';

/** @typedef {import('markdown-it').RendererRule} RenderRule */

const md = new MarkdownIt({ html: false, linkify: true, typographer: true });

/** @type {RenderRule} */
const renderToken = (tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options);

// External links open safely; internal ones are left alone.
const defaultLinkOpen = md.renderer.rules.link_open ?? renderToken;
/** @type {RenderRule} */
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const href = String(tokens[idx].attrGet('href') ?? '');
  if (/^https?:\/\//i.test(href)) tokens[idx].attrSet('rel', 'noopener');
  return defaultLinkOpen(tokens, idx, options, env, self);
};

// Post images are below the fold: lazy-load them.
const defaultImage = md.renderer.rules.image ?? renderToken;
/** @type {RenderRule} */
md.renderer.rules.image = (tokens, idx, options, env, self) => {
  tokens[idx].attrSet('loading', 'lazy');
  return defaultImage(tokens, idx, options, env, self);
};

/** @param {string} source */
export function renderMarkdown(source) {
  return md.render(source);
}

/**
 * Plain text of the first paragraph, for feeds. Markdown syntax is stripped
 * crudely; it's a summary, not a renderer.
 * @param {string} source
 * @param {number} [max]
 */
export function excerpt(source, max = 200) {
  const text = source
    .replace(/^#.*$/gm, '')
    .replace(/[*_`>#[\]]/g, '')
    .replace(/\(https?:[^)]*\)/g, '')
    .trim()
    .split(/\n\s*\n/)[0]
    .replace(/\s+/g, ' ');
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
