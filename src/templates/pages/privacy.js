import { html } from '../../lib/html.js';
import { layout } from '../layout.js';
import { displayDate } from '../components.js';

export const path = '/privacy';

/** @param {import('../../build/context.js').BuildContext} ctx */
export function render(ctx) {
  const { site } = ctx;
  const body = html`
    <article class="container-narrow max-w-3xl py-20">
      <h1 class="text-4xl font-bold tracking-tight">Privacy</h1>
      <p class="mt-3 text-sm text-ink-muted">Last updated <time datetime="${site.privacy.updated}">${displayDate(site.privacy.updated)}</time></p>
      <div class="prose-post mt-10">
        <h2>Who is responsible</h2>
        <p>${site.privacy.controller}. Questions: ${site.privacy.contactEmail}.</p>

        <h2>What this site collects</h2>
        <p>When you send the contact form, we store your name, email address, company (if given) and message, plus the time and the page you sent it from, so we can reply. When you subscribe, we store your email address and which list you chose.</p>
        <p>The web server keeps standard access logs (IP address, requested page, browser type) for up to 30 days to run the site and stop abuse. Form contents are never written to logs.</p>

        <h2>Where it goes</h2>
        <p>Submissions are stored on our own server and forwarded to our automation system (n8n), which we operate, so we can follow up. We do not sell or share your data with advertisers. We do not use tracking cookies or third-party analytics.</p>

        <h2>How long we keep it</h2>
        <p>Contact submissions are kept while we are in conversation and for up to two years after. Subscriptions are kept until you unsubscribe.</p>

        <h2>Your rights</h2>
        <p>You can ask what we hold about you, ask for it to be corrected or deleted, or object to how we use it, by writing to ${site.privacy.contactEmail}.</p>
      </div>
    </article>
  `;
  return layout(
    ctx,
    {
      title: 'Privacy',
      description: `How ${site.name} handles the personal data you send through this site.`,
      path,
      noindex: true,
    },
    body,
  );
}
