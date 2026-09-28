import { html } from '../../lib/html.js';
import { layout } from '../layout.js';

export const path = '/404';

/** @param {import('../../build/context.js').BuildContext} ctx */
export function render(ctx) {
  const body = html`
    <section class="container-narrow py-32 text-center">
      <p class="text-sm font-semibold uppercase tracking-wide text-accent">404</p>
      <h1 class="mt-2 text-4xl font-bold tracking-tight">Page not found</h1>
      <p class="mt-4 text-ink-muted">That link is broken or the page has moved.</p>
      <a href="/" class="btn-primary mt-8">Back to home</a>
    </section>
  `;
  return layout(
    ctx,
    {
      title: 'Page not found',
      description: 'The page you asked for does not exist.',
      path,
      noindex: true,
    },
    body,
  );
}
