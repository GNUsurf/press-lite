import { html } from '../../lib/html.js';
import { layout } from '../layout.js';
import { postCard, subscribeForm } from '../components.js';

export const path = '/blog';

/** @param {import('../../build/context.js').BuildContext} ctx */
export function render(ctx) {
  const body = html`
    <section class="container-narrow py-20">
      <h1 class="text-4xl font-bold tracking-tight sm:text-5xl">Blog</h1>
      <p class="mt-4 max-w-2xl text-lg text-ink-muted">Notes on marketing automation, content systems and n8n.</p>
    </section>
    <section class="container-narrow pb-20">
      ${
        ctx.posts.length
          ? html`<div class="grid gap-12 md:grid-cols-2 lg:grid-cols-3">${ctx.posts.map((post, i) => postCard(post, { lazy: i > 2 }))}</div>`
          : html`<p class="text-ink-muted">No posts yet.</p>`
      }
    </section>
    <section id="subscribe" class="bg-paper-alt py-16">
      <div class="container-narrow max-w-2xl">
        <h2 class="text-2xl font-bold tracking-tight">${ctx.site.newsletter.heading}</h2>
        <p class="mt-2 text-ink-muted">${ctx.site.newsletter.body}</p>
        <div class="mt-6">${subscribeForm('/blog')}</div>
      </div>
    </section>
  `;
  return layout(
    ctx,
    {
      title: 'Blog',
      description: `Articles from ${ctx.site.name} on marketing automation and content systems.`,
      path,
    },
    body,
  );
}
