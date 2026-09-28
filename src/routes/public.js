/**
 * Public form endpoints: /api/contact and /api/subscribe.
 *
 * Both accept JSON (from the page script) or form-encoded bodies (plain
 * browser posts with JavaScript off). A form post gets a 303 back to the page
 * with `?sent=1` or `?error=<code>`; the error side lives in the server's
 * error handler, keyed on `config.formRedirect`.
 */
import { MINUTE } from '../lib/time.js';
import { withQuery } from '../lib/urls.js';
import { createLead } from '../services/leads.js';
import { createSubscriber, LIST_PATTERN } from '../services/subscribers.js';

const RATE_LIMIT = { max: 5, timeWindow: 10 * MINUTE };

const email = { type: 'string', format: 'email', maxLength: 254 };
const optionalText = (/** @type {number} */ maxLength) => ({ type: 'string', maxLength });
const formId = { type: 'string', pattern: '^[0-9a-f-]{36}$' };

const contactBody = {
  type: 'object',
  required: ['name', 'email', 'message'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 100 },
    email,
    company: optionalText(200),
    message: { type: 'string', minLength: 1, maxLength: 5000 },
    source: optionalText(200),
    form_id: { anyOf: [formId, { type: 'string', maxLength: 0 }] },
    website: optionalText(500), // honeypot
  },
};

const subscribeBody = {
  type: 'object',
  required: ['email', 'list'],
  additionalProperties: false,
  properties: {
    email,
    list: { type: 'string', pattern: LIST_PATTERN, maxLength: 100 },
    source: optionalText(200),
    form_id: { anyOf: [formId, { type: 'string', maxLength: 0 }] },
    website: optionalText(500),
  },
};

/** @type {import('fastify').FastifyPluginAsync} */
export async function publicRoutes(app) {
  app.post(
    '/contact',
    {
      schema: { body: contactBody },
      config: { rateLimit: RATE_LIMIT, formRedirect: '/contact' },
    },
    async (request, reply) => {
      const body = /** @type {ContactBody} */ (request.body);
      if (!body.website) {
        createLead(
          app.db,
          {
            name: body.name,
            email: body.email,
            company: body.company,
            message: body.message,
            source: body.source,
            formId: body.form_id,
          },
          app.clock,
        );
      }
      return accepted(request, reply, '/contact');
    },
  );

  app.post(
    '/subscribe',
    {
      schema: { body: subscribeBody },
      config: { rateLimit: RATE_LIMIT, formRedirect: '/' },
    },
    async (request, reply) => {
      const body = /** @type {SubscribeBody} */ (request.body);
      if (!body.website) {
        createSubscriber(
          app.db,
          { email: body.email, list: body.list, source: body.source, formId: body.form_id },
          app.clock,
        );
      }
      return accepted(request, reply, sameSitePath(body.source));
    },
  );
}

/**
 * 202 for API callers, 303 for plain browser forms. Honeypot hits get the
 * same response as real submissions, so bots learn nothing. `#sent` lets the
 * page reveal its confirmation with CSS :target.
 * @param {import('fastify').FastifyRequest} request
 * @param {import('fastify').FastifyReply} reply
 * @param {string} redirectTo
 */
function accepted(request, reply, redirectTo) {
  if (request.isFormPost) {
    return reply.redirect(withQuery(`${redirectTo}#sent`, { sent: '1' }), 303);
  }
  return reply.code(202).send({ ok: true });
}

/**
 * Where a subscribe form post goes back to: the page it came from, if
 * `source` is a plain same-site path, else home. Never an open redirect.
 * @param {string | undefined} source
 */
function sameSitePath(source) {
  return source && /^\/[a-z0-9/-]*$/.test(source) ? source : '/';
}

/**
 * @typedef {{ name: string, email: string, company?: string, message: string,
 *   source?: string, form_id?: string, website?: string }} ContactBody
 * @typedef {{ email: string, list: string, source?: string, form_id?: string,
 *   website?: string }} SubscribeBody
 */
