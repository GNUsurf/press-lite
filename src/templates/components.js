/**
 * Shared page pieces. Every function returns html`` and takes only what it
 * needs, so pages stay short.
 */
import { html, safeUrl } from '../lib/html.js';

/**
 * Fixed top bar. Without JavaScript the menu is always visible; site.js
 * hides it behind the button on small screens.
 * @param {import('../build/context.js').BuildContext} ctx
 * @param {string} currentPath
 */
export function nav(ctx, currentPath) {
  return html`
    <header class="fixed inset-x-0 top-0 z-50 h-nav bg-ink/85 text-white backdrop-blur">
      <div class="container-narrow flex h-full items-center justify-between">
        <a href="/" class="text-lg font-bold tracking-tight">${ctx.site.name}</a>
        <button type="button" class="rounded-md p-2 md:hidden" data-menu-toggle aria-expanded="false" aria-controls="site-menu" aria-label="Menu">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"></path></svg>
        </button>
        <nav id="site-menu" data-menu aria-label="Main" class="absolute inset-x-0 top-full bg-ink/95 md:static md:block md:bg-transparent">
          <ul class="container-narrow flex flex-col gap-1 py-3 md:flex-row md:gap-6 md:p-0">
            ${ctx.site.nav.map(
              (item) => html`
            <li><a href="${safeUrl(item.href)}" class="block py-2 text-sm font-medium hover:text-white/80${currentPath === item.href ? ' underline underline-offset-4' : ''}"${currentPath === item.href ? html` aria-current="page"` : null}>${item.label}</a></li>`,
            )}
          </ul>
        </nav>
      </div>
    </header>
  `;
}

/** @param {import('../build/context.js').BuildContext} ctx */
export function footer(ctx) {
  const year = new Date(ctx.builtAt).getUTCFullYear();
  return html`
    <footer class="border-t border-slate-200 bg-paper-alt">
      <div class="container-narrow flex flex-col gap-6 py-10 text-sm text-ink-muted md:flex-row md:items-center md:justify-between">
        <p>&copy; ${year} ${ctx.site.legalName}</p>
        <ul class="flex flex-wrap gap-5">
          ${Object.entries(ctx.site.links).map(
            ([label, href]) =>
              html`<li><a href="${safeUrl(href)}" rel="me noopener" class="hover:text-ink">${label}</a></li>`,
          )}
          <li><a href="/feed.xml" class="hover:text-ink">RSS</a></li>
          <li><a href="/privacy" class="hover:text-ink">Privacy</a></li>
        </ul>
      </div>
    </footer>
  `;
}

/**
 * @param {string} eyebrow
 * @param {string} heading
 * @param {string} [body]
 */
export function sectionHeading(eyebrow, heading, body) {
  return html`
    <div class="max-w-2xl">
      <p class="text-sm font-semibold uppercase tracking-wide text-accent">${eyebrow}</p>
      <h2 class="mt-2 text-3xl font-bold tracking-tight">${heading}</h2>
      ${body ? html`<p class="mt-4 text-lg text-ink-muted">${body}</p>` : null}
    </div>
  `;
}

/**
 * Contact form: works as a plain POST (303 back here) and is enhanced by
 * site.js (JSON + form_id). The honeypot is `website`.
 * @param {string} sourcePath
 */
export function contactForm(sourcePath) {
  return html`
    <form method="post" action="/api/contact" class="grid gap-5" data-enhance data-success="Thanks, your message is in. You'll hear back within one business day.">
      <input type="hidden" name="form_id" value="">
      <input type="hidden" name="source" value="${sourcePath}">
      <div class="hidden">
        <label for="contact-website">Website</label>
        <input id="contact-website" name="website" type="text" tabindex="-1" autocomplete="off">
      </div>
      <div class="grid gap-5 sm:grid-cols-2">
        ${field('contact-name', 'name', 'Name', { autocomplete: 'name', required: true, maxlength: 100 })}
        ${field('contact-email', 'email', 'Email', { type: 'email', autocomplete: 'email', required: true })}
      </div>
      ${field('contact-company', 'company', 'Company (optional)', { autocomplete: 'organization', maxlength: 200 })}
      <div class="grid gap-1.5">
        <label for="contact-message" class="text-sm font-medium">What are you working on?</label>
        <textarea id="contact-message" name="message" rows="6" required maxlength="5000" class="field"></textarea>
      </div>
      <div class="flex flex-wrap items-center gap-4">
        <button type="submit" class="btn-primary">Send message</button>
        <p data-status aria-live="polite" class="text-sm text-ink-muted"></p>
      </div>
      ${formOutcome('Thanks, your message is in.', 'Something went wrong and the message was not sent. Please try again or email instead.')}
    </form>
  `;
}

/**
 * Newsletter signup. Same contract as the contact form.
 * @param {string} sourcePath
 */
export function subscribeForm(sourcePath) {
  return html`
    <form method="post" action="/api/subscribe" class="grid gap-3 sm:flex sm:flex-wrap sm:items-end" data-enhance data-success="You're on the list. Check your inbox to confirm.">
      <input type="hidden" name="form_id" value="">
      <input type="hidden" name="source" value="${sourcePath}">
      <input type="hidden" name="list" value="newsletter">
      <div class="hidden">
        <label for="subscribe-website">Website</label>
        <input id="subscribe-website" name="website" type="text" tabindex="-1" autocomplete="off">
      </div>
      <div class="grid flex-1 gap-1.5">
        <label for="subscribe-email" class="text-sm font-medium">Email</label>
        <input id="subscribe-email" name="email" type="email" required autocomplete="email" class="field">
      </div>
      <button type="submit" class="btn-primary">Subscribe</button>
      <p data-status aria-live="polite" class="text-sm text-ink-muted sm:basis-full"></p>
      ${formOutcome("You're on the list. Check your inbox to confirm.", 'That did not go through. Please try again.')}
    </form>
  `;
}

/**
 * No-JS feedback: the server redirects to `?sent=1#sent` or `?error=x#error`
 * and CSS `:target` reveals the matching block.
 * @param {string} sent
 * @param {string} error
 */
function formOutcome(sent, error) {
  return html`
      <p id="sent" class="hidden rounded-md bg-green-50 p-3 text-sm text-green-900 target:block sm:basis-full" role="status">${sent}</p>
      <p id="error" class="hidden rounded-md bg-red-50 p-3 text-sm text-red-900 target:block sm:basis-full" role="alert">${error}</p>
  `;
}

/**
 * @param {string} id
 * @param {string} name
 * @param {string} label
 * @param {{ type?: string, autocomplete?: string, required?: boolean, maxlength?: number }} attrs
 */
function field(id, name, label, { type = 'text', autocomplete, required = false, maxlength } = {}) {
  return html`
        <div class="grid gap-1.5">
          <label for="${id}" class="text-sm font-medium">${label}</label>
          <input id="${id}" name="${name}" type="${type}" class="field"${autocomplete ? html` autocomplete="${autocomplete}"` : null}${required ? html` required` : null}${maxlength ? html` maxlength="${maxlength}"` : null}>
        </div>`;
}

/**
 * @param {import('../content/posts.js').Post} post
 * @param {{ lazy?: boolean }} [options]
 */
export function postCard(post, { lazy = true } = {}) {
  return html`
    <article class="flex flex-col gap-3">
      ${
        post.coverUrl && post.coverSize
          ? html`<a href="/blog/${post.slug}" tabindex="-1" aria-hidden="true"><img src="${post.coverUrl}" alt="" width="${post.coverSize.width}" height="${post.coverSize.height}" class="aspect-[16/9] w-full rounded-md object-cover"${lazy ? html` loading="lazy"` : null}></a>`
          : null
      }
      <p class="text-sm text-ink-muted"><time datetime="${post.date}">${displayDate(post.date)}</time></p>
      <h3 class="text-xl font-semibold"><a href="/blog/${post.slug}" class="hover:underline">${post.title}</a></h3>
      <p class="text-ink-muted">${post.description}</p>
    </article>
  `;
}

/** @param {string} isoDate YYYY-MM-DD */
export function displayDate(isoDate) {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * A decorative block that stands in for a photo until real assets exist.
 * @param {string} [extra] classes
 */
export function placeholderArt(extra = '') {
  return html`<div class="aspect-[16/10] w-full rounded-md bg-gradient-to-br from-slate-200 via-slate-100 to-blue-100 ${extra}" aria-hidden="true"></div>`;
}
