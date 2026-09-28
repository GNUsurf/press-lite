import { html } from '../../lib/html.js';
import { layout } from '../layout.js';
import { placeholderArt } from '../components.js';

export const path = '/about';

/** @param {import('../../build/context.js').BuildContext} ctx */
export function render(ctx) {
  const { site } = ctx;
  const body = html`
    <section class="container-narrow grid gap-12 py-20 md:grid-cols-2 md:items-start">
      <div>
        <h1 class="text-4xl font-bold tracking-tight sm:text-5xl">${site.about.heading}</h1>
        <div class="mt-8 space-y-5 text-lg leading-relaxed">
          ${site.about.bio.map((p) => html`<p>${p}</p>`)}
        </div>
        <a href="/contact" class="btn-primary mt-10">Get in touch</a>
      </div>
      ${placeholderArt('md:sticky md:top-24')}
    </section>
  `;
  return layout(ctx, { title: 'About', description: site.about.teaser, path }, body);
}
