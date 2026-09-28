import { html } from '../../lib/html.js';
import { layout } from '../layout.js';
import { placeholderArt } from '../components.js';

export const path = '/work';

/** @param {import('../../build/context.js').BuildContext} ctx */
export function render(ctx) {
  const { site } = ctx;
  const body = html`
    <section class="container-narrow py-20">
      <h1 class="text-4xl font-bold tracking-tight sm:text-5xl">Work</h1>
      <p class="mt-4 max-w-2xl text-lg text-ink-muted">Selected projects. Each one is a system the client owns and runs.</p>
    </section>
    <section class="container-narrow grid gap-16 pb-20">
      ${site.work.map(
        (w) => html`
      <article id="${w.slug}" class="grid gap-8 md:grid-cols-2 md:items-center">
        ${placeholderArt()}
        <div>
          <p class="text-sm font-semibold uppercase tracking-wide text-accent">${w.client}</p>
          <h2 class="mt-2 text-3xl font-bold tracking-tight">${w.title}</h2>
          <p class="mt-4 text-lg text-ink-muted">${w.summary}</p>
          <p class="mt-6 rounded-md bg-paper-alt p-4 font-semibold">${w.result}</p>
        </div>
      </article>`,
      )}
    </section>
  `;
  return layout(
    ctx,
    { title: 'Work', description: `Case studies and selected projects by ${site.name}.`, path },
    body,
  );
}
