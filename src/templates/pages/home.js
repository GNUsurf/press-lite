import { html, safeUrl } from '../../lib/html.js';
import { layout } from '../layout.js';
import { professionalService } from '../seo.js';
import { sectionHeading, postCard, subscribeForm, placeholderArt } from '../components.js';

export const path = '/';

/** @param {import('../../build/context.js').BuildContext} ctx */
export function render(ctx) {
  const { site, assets } = ctx;
  const body = html`
    <section class="hero relative flex items-end overflow-hidden bg-ink text-white">
      <img src="/hero-poster.jpg" alt="" width="${assets.heroPoster.width}" height="${assets.heroPoster.height}" fetchpriority="high" class="absolute inset-0 h-full w-full object-cover">
      ${
        assets.heroVideo
          ? html`<video data-hero class="absolute inset-0 h-full w-full object-cover motion-reduce:hidden" autoplay muted loop playsinline poster="/hero-poster.jpg" aria-hidden="true" tabindex="-1"><source src="/hero.mp4" type="video/mp4"></video>`
          : null
      }
      <div class="absolute inset-0 bg-gradient-to-t from-ink/95 via-ink/60 to-ink/20" aria-hidden="true"></div>
      <div class="container-narrow relative pb-24 pt-40">
        <h1 class="max-w-3xl text-4xl font-bold tracking-tight sm:text-6xl">${site.hero.headline}</h1>
        <p class="mt-6 max-w-2xl text-lg text-white/85 sm:text-xl">${site.hero.subhead}</p>
        <div class="mt-10 flex flex-wrap gap-4">
          <a href="${safeUrl(site.hero.cta.href)}" class="btn-primary">${site.hero.cta.label}</a>
          <a href="/services" class="btn-ghost">See services</a>
        </div>
      </div>
    </section>

    <section class="container-narrow py-20">
      ${sectionHeading('Why this works', site.valueProposition.heading, site.valueProposition.body)}
      <a href="${safeUrl(site.hero.cta.href)}" class="btn-primary mt-8">${site.hero.cta.label}</a>
    </section>

    <section class="bg-paper-alt py-20">
      <div class="container-narrow">
        ${sectionHeading('How it works', 'From first call to running system')}
        <ol class="mt-12 grid gap-8 md:grid-cols-3">
          ${site.howItWorks.map(
            (step, i) => html`
          <li class="rounded-lg border border-slate-200 bg-white p-6">
            <p class="text-sm font-semibold text-accent">Step ${i + 1}</p>
            <h3 class="mt-2 text-xl font-semibold">${step.title}</h3>
            <p class="mt-3 text-ink-muted">${step.body}</p>
          </li>`,
          )}
        </ol>
      </div>
    </section>

    <section class="container-narrow py-20">
      ${sectionHeading('Services', 'What I build')}
      <ul class="mt-12 grid gap-8 md:grid-cols-3">
        ${site.services.map(
          (s) => html`
        <li>
          <h3 class="text-xl font-semibold"><a href="/services#${s.slug}" class="hover:underline">${s.title}</a></h3>
          <p class="mt-3 text-ink-muted">${s.summary}</p>
        </li>`,
        )}
      </ul>
    </section>

    <section class="bg-paper-alt py-20">
      <div class="container-narrow">
        ${sectionHeading('Featured work', 'Recent projects')}
        <ul class="mt-12 grid gap-8 md:grid-cols-2">
          ${site.work.map(
            (w) => html`
          <li class="flex flex-col gap-4">
            ${placeholderArt()}
            <h3 class="text-xl font-semibold"><a href="/work#${w.slug}" class="hover:underline">${w.title}</a></h3>
            <p class="text-ink-muted">${w.summary}</p>
          </li>`,
          )}
        </ul>
      </div>
    </section>

    ${
      ctx.posts.length
        ? html`
    <section class="container-narrow py-20">
      ${sectionHeading('Blog', 'Latest writing')}
      <div class="mt-12 grid gap-10 md:grid-cols-3">
        ${ctx.posts.slice(0, 3).map((post) => postCard(post))}
      </div>
      <a href="/blog" class="mt-10 inline-block font-semibold text-accent hover:underline">All posts →</a>
    </section>`
        : null
    }

    <section class="bg-paper-alt py-20">
      <div class="container-narrow grid gap-10 md:grid-cols-2 md:items-center">
        <div>
          ${sectionHeading('About', site.about.heading, site.about.teaser)}
          <a href="/about" class="mt-6 inline-block font-semibold text-accent hover:underline">More about me →</a>
        </div>
        ${placeholderArt()}
      </div>
    </section>

    <section class="container-narrow py-20">
      ${sectionHeading('Testimonials', 'What clients say')}
      <ul class="mt-12 grid gap-8 md:grid-cols-2">
        ${site.testimonials.map(
          (t) => html`
        <li>
          <blockquote class="rounded-lg border border-slate-200 p-6">
            <p class="text-lg">“${t.quote}”</p>
            <footer class="mt-4 text-sm text-ink-muted">${t.author}</footer>
          </blockquote>
        </li>`,
        )}
      </ul>
    </section>

    <section id="subscribe" class="bg-paper-alt py-20">
      <div class="container-narrow max-w-2xl">
        ${sectionHeading('Newsletter', site.newsletter.heading, site.newsletter.body)}
        <div class="mt-8">${subscribeForm('/')}</div>
      </div>
    </section>

    <section class="bg-ink py-20 text-white">
      <div class="container-narrow flex flex-col items-start gap-6 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 class="text-3xl font-bold tracking-tight">${site.contact.heading}</h2>
          <p class="mt-3 max-w-xl text-white/80">${site.contact.body}</p>
        </div>
        <a href="/contact" class="btn-primary">Get in touch</a>
      </div>
    </section>
  `;

  return layout(
    ctx,
    { title: site.tagline, description: site.description, path, jsonLd: professionalService(ctx) },
    body,
    { hero: true },
  );
}
