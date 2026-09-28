/**
 * JSON Schema for site copy: the shape of `site.config.js`, with limits.
 * Fastify validates API bodies against `SITE_COPY_SCHEMA`; `validateSiteCopy`
 * is a small walker over the same schema for places without Ajv (the seed
 * import), so there is one definition of "valid site copy".
 */

const text = (/** @type {number} */ max, min = 1) => ({
  type: 'string',
  minLength: min,
  maxLength: max,
});
const url = { type: 'string', pattern: '^(https?://|mailto:|/)\\S+$', maxLength: 300 };
const slug = { type: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$', maxLength: 60 };

/** @param {Record<string, unknown>} properties @param {string[]} [required] */
const object = (properties, required = Object.keys(properties)) => ({
  type: 'object',
  additionalProperties: false,
  required,
  properties,
});

/** @param {unknown} items @param {number} max @param {number} [min] */
const list = (items, max, min = 0) => ({ type: 'array', items, minItems: min, maxItems: max });

export const SITE_COPY_SCHEMA = object({
  name: text(60),
  legalName: text(120),
  tagline: text(120),
  description: text(160, 20),
  locale: { type: 'string', pattern: '^[a-z]{2}_[A-Z]{2}$' },
  hero: object({
    headline: text(90),
    subhead: text(200),
    cta: object({ label: text(40), href: url }),
  }),
  valueProposition: object({ heading: text(90), body: text(600) }),
  howItWorks: list(object({ title: text(60), body: text(300) }), 4, 3),
  services: list(object({ slug, title: text(70), summary: text(160), body: text(800) }), 6, 1),
  work: list(
    object({ slug, client: text(120), title: text(90), summary: text(400), result: text(160) }),
    6,
  ),
  about: object({ heading: text(90), teaser: text(300), bio: list(text(800), 6, 1) }),
  testimonials: list(object({ quote: text(400), author: text(120) }), 6),
  contact: object({ heading: text(90), body: text(300), email: text(120) }),
  newsletter: object({ heading: text(90), body: text(300) }),
  links: { type: 'object', additionalProperties: url, maxProperties: 8 },
  nav: list(object({ label: text(30), href: url }), 8, 1),
  privacy: object({
    controller: text(300),
    contactEmail: text(120),
    updated: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
  }),
});

/**
 * Validate against SITE_COPY_SCHEMA without Ajv. Covers the keywords the
 * schema above uses and nothing more.
 * @param {unknown} value
 * @returns {string[]} problems, empty when valid
 */
export function validateSiteCopy(value) {
  /** @type {string[]} */
  const problems = [];
  walk(SITE_COPY_SCHEMA, value, '$', problems);
  return problems;
}

/**
 * @param {any} schema @param {unknown} value @param {string} at @param {string[]} out
 */
function walk(schema, value, at, out) {
  switch (schema.type) {
    case 'string': {
      if (typeof value !== 'string') return out.push(`${at}: must be a string`);
      if (schema.minLength !== undefined && value.length < schema.minLength)
        out.push(`${at}: too short`);
      if (schema.maxLength !== undefined && value.length > schema.maxLength)
        out.push(`${at}: too long`);
      if (schema.pattern && !new RegExp(schema.pattern).test(value)) out.push(`${at}: bad format`);
      return;
    }
    case 'array': {
      if (!Array.isArray(value)) return out.push(`${at}: must be a list`);
      if (schema.minItems !== undefined && value.length < schema.minItems)
        out.push(`${at}: too few items`);
      if (schema.maxItems !== undefined && value.length > schema.maxItems)
        out.push(`${at}: too many items`);
      value.forEach((v, i) => walk(schema.items, v, `${at}[${i}]`, out));
      return;
    }
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return out.push(`${at}: must be an object`);
      }
      const obj = /** @type {Record<string, unknown>} */ (value);
      for (const key of schema.required ?? [])
        if (!(key in obj)) out.push(`${at}.${key}: required`);
      if (schema.maxProperties !== undefined && Object.keys(obj).length > schema.maxProperties) {
        out.push(`${at}: too many entries`);
      }
      for (const [key, v] of Object.entries(obj)) {
        const sub =
          schema.properties?.[key] ??
          (schema.additionalProperties !== false ? schema.additionalProperties : null);
        if (!sub) out.push(`${at}.${key}: unknown field`);
        else if (sub !== true) walk(sub, v, `${at}.${key}`, out);
      }
      return;
    }
    default:
      out.push(`${at}: unsupported schema`);
  }
}
