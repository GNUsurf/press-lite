import { html } from '../../lib/html.js';
import { layout } from '../layout.js';
import { contactForm } from '../components.js';

export const path = '/contact';

/** @param {import('../../build/context.js').BuildContext} ctx */
export function render(ctx) {
  const { site } = ctx;
  const body = html`
    <section class="container-narrow grid gap-12 py-20 md:grid-cols-[2fr_3fr]">
      <div>
        <h1 class="text-4xl font-bold tracking-tight sm:text-5xl">${site.contact.heading}</h1>
        <p class="mt-4 text-lg text-ink-muted">${site.contact.body}</p>
        <p class="mt-8 text-ink-muted">Prefer email? <span class="font-medium text-ink">${site.contact.email}</span></p>
      </div>
      <div>${contactForm(path)}</div>
    </section>
  `;
  return layout(
    ctx,
    { title: 'Contact', description: `${site.contact.heading} ${site.contact.body}`, path },
    body,
  );
}
