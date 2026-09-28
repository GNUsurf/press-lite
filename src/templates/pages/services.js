import { html } from '../../lib/html.js';
import { layout } from '../layout.js';
import { sectionHeading } from '../components.js';

export const path = '/services';

/** @param {import('../../build/context.js').BuildContext} ctx */
export function render(ctx) {
  const { site } = ctx;
  const body = html`
    <section class="container-narrow py-20">
      <h1 class="text-4xl font-bold tracking-tight sm:text-5xl">Services</h1>
      <p class="mt-4 max-w-2xl text-lg text-ink-muted">${site.tagline}</p>
    </section>
    ${site.services.map(
      (s, i) => html`
    <section id="${s.slug}" class="${i % 2 ? '' : 'bg-paper-alt '}py-16">
      <div class="container-narrow grid gap-8 md:grid-cols-[1fr_2fr]">
        ${sectionHeading(`Service ${i + 1}`, s.title, s.summary)}
        <p class="text-lg leading-relaxed">${s.body}</p>
      </div>
    </section>`,
    )}
    <section class="container-narrow py-20">
      <h2 class="text-3xl font-bold tracking-tight">${site.contact.heading}</h2>
      <p class="mt-3 max-w-xl text-ink-muted">${site.contact.body}</p>
      <a href="/contact" class="btn-primary mt-8">Get in touch</a>
    </section>
  `;
  return layout(
    ctx,
    {
      title: 'Services',
      description: `Services from ${site.name}: ${site.services.map((s) => s.title).join(', ')}.`,
      path,
    },
    body,
  );
}
