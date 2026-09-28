import { html, raw } from '../../lib/html.js';
import { absoluteUrl } from '../../lib/urls.js';
import { layout } from '../layout.js';
import { blogPosting } from '../seo.js';
import { displayDate, subscribeForm } from '../components.js';

/**
 * @param {import('../../build/context.js').BuildContext} ctx
 * @param {import('../../content/posts.js').Post} post
 */
export function renderPost(ctx, post) {
  const path = `/blog/${post.slug}`;
  const body = html`
    <article class="container-narrow max-w-3xl py-20">
      <header>
        <p class="text-sm text-ink-muted"><time datetime="${post.date}">${displayDate(post.date)}</time></p>
        <h1 class="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">${post.title}</h1>
        <p class="mt-4 text-xl text-ink-muted">${post.description}</p>
        <ul class="mt-6 flex flex-wrap gap-2" aria-label="Tags">
          ${post.tags.map((tag) => html`<li class="rounded-full bg-paper-alt px-3 py-1 text-sm text-ink-muted">${tag}</li>`)}
        </ul>
        ${
          post.coverUrl && post.coverSize
            ? html`<img src="${post.coverUrl}" alt="" width="${post.coverSize.width}" height="${post.coverSize.height}" fetchpriority="high" class="mt-10 w-full rounded-lg">`
            : null
        }
      </header>
      <div class="prose-post mt-10">${raw(post.html)}</div>
      <footer class="mt-16 border-t border-slate-200 pt-8">
        <a href="/blog" class="font-semibold text-accent hover:underline">← All posts</a>
      </footer>
    </article>
    <section id="subscribe" class="bg-paper-alt py-16">
      <div class="container-narrow max-w-2xl">
        <h2 class="text-2xl font-bold tracking-tight">${ctx.site.newsletter.heading}</h2>
        <p class="mt-2 text-ink-muted">${ctx.site.newsletter.body}</p>
        <div class="mt-6">${subscribeForm(path)}</div>
      </div>
    </section>
  `;
  return layout(
    ctx,
    {
      title: post.title,
      description: post.description,
      path,
      ogType: 'article',
      ogImage: post.coverUrl ? absoluteUrl(ctx.siteUrl, post.coverUrl) : undefined,
      jsonLd: blogPosting(ctx, post),
    },
    body,
  );
}
