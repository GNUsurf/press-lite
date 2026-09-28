/**
 * ALL brand copy lives here. Templates never contain brand text, so a rebrand
 * touches this file (and public/ assets) only.
 *
 * Everything in square brackets is a placeholder. Do not invent testimonials,
 * client names, logos or results metrics; replace them with real ones.
 */

/** @typedef {typeof site} SiteConfig */

export const site = {
  name: 'PY Team',
  legalName: '[LEGAL ENTITY NAME]',
  tagline: '[TAGLINE — one line on what you do and for whom]',
  description:
    '[META DESCRIPTION — 120 to 160 characters on marketing and content automation for the businesses you serve]',
  locale: 'en_US',

  hero: {
    headline: 'Py Marketing Automation',
    subhead: 'We do the heavy lifting.',
    cta: { label: 'Book a call', href: '/contact' },
  },

  valueProposition: {
    heading: '[VALUE PROPOSITION HEADING]',
    body: '[VALUE PROPOSITION — two or three sentences on the problem you solve and what changes when it is solved]',
  },

  howItWorks: [
    { title: '[STEP 1 TITLE]', body: '[Step 1 — what happens first, e.g. a short audit call]' },
    { title: '[STEP 2 TITLE]', body: '[Step 2 — what you build and how long it takes]' },
    { title: '[STEP 3 TITLE]', body: '[Step 3 — handover, training, what the client owns]' },
  ],

  services: [
    {
      slug: 'marketing-automation',
      title: '[SERVICE 1 — e.g. Marketing automation]',
      summary: '[One sentence on the service]',
      body: '[Two or three sentences on what is included and who it is for]',
    },
    {
      slug: 'content-systems',
      title: '[SERVICE 2 — e.g. Content systems]',
      summary: '[One sentence on the service]',
      body: '[Two or three sentences on what is included and who it is for]',
    },
    {
      slug: 'n8n-workflows',
      title: '[SERVICE 3 — e.g. n8n workflow engineering]',
      summary: '[One sentence on the service]',
      body: '[Two or three sentences on what is included and who it is for]',
    },
  ],

  work: [
    {
      slug: 'case-study-one',
      client: '[CLIENT NAME — replace with a real client, with permission]',
      title: '[CASE STUDY TITLE]',
      summary: '[What the client needed, what you built, what changed]',
      result: '[RESULT — replace with a real, verifiable metric]',
    },
    {
      slug: 'case-study-two',
      client: '[CLIENT NAME — replace with a real client, with permission]',
      title: '[CASE STUDY TITLE]',
      summary: '[What the client needed, what you built, what changed]',
      result: '[RESULT — replace with a real, verifiable metric]',
    },
  ],

  about: {
    heading: '[ABOUT HEADING]',
    teaser: '[ABOUT TEASER — two sentences on who you are and why you do this]',
    bio: [
      '[BIO PARAGRAPH 1 — background and experience]',
      '[BIO PARAGRAPH 2 — how you work and what clients can expect]',
    ],
  },

  testimonials: [
    { quote: '[TESTIMONIAL — replace with a real client quote]', author: '[NAME, ROLE, COMPANY]' },
    { quote: '[TESTIMONIAL — replace with a real client quote]', author: '[NAME, ROLE, COMPANY]' },
  ],

  contact: {
    heading: '[CONTACT HEADING — e.g. Tell me about your project]',
    body: '[One sentence on what happens after they write, and how soon you reply]',
    email: '[hello@example.com]',
  },

  newsletter: {
    heading: '[NEWSLETTER HEADING]',
    body: '[One sentence on what subscribers get and how often]',
  },

  links: {
    linkedin: 'https://www.linkedin.com/in/[handle]',
    github: 'https://github.com/[handle]',
  },

  nav: [
    { label: 'Services', href: '/services' },
    { label: 'Work', href: '/work' },
    { label: 'Blog', href: '/blog' },
    { label: 'About', href: '/about' },
    { label: 'Contact', href: '/contact' },
  ],

  privacy: {
    controller: '[LEGAL ENTITY NAME and postal address]',
    contactEmail: '[privacy@example.com]',
    updated: '2026-01-01',
  },
};
