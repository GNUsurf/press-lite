/**
 * OpenAPI 3.1 for /api, generated from the routes themselves: each route's
 * JSON Schema (params, querystring, body) and the scope/idempotency tags on
 * its preHandlers come from Fastify; the prose comes from OPERATIONS below.
 * A route without an OPERATIONS entry fails a test, so the docs can't lag
 * the code.
 */

/**
 * @typedef {object} CollectedRoute
 * @property {string} method
 * @property {string} url                 Fastify style, /api/v1/posts/:id
 * @property {Record<string, any>} schema
 * @property {string | null} scope
 * @property {boolean} idempotent
 */

/**
 * An onRoute hook plus the array it fills. Register the hook before any
 * routes. HEAD twins and non-API routes are ignored.
 * @returns {{ routes: CollectedRoute[], hook: (route: import('fastify').RouteOptions & { prefix?: string }) => void }}
 */
export function routeCollector() {
  /** @type {CollectedRoute[]} */
  const routes = [];
  return {
    routes,
    hook(route) {
      const methods = Array.isArray(route.method) ? route.method : [route.method];
      const url = route.url;
      if (!(url.startsWith('/api/') || url.startsWith('/preview/'))) return;
      const handlers = /** @type {any[]} */ (
        Array.isArray(route.preHandler)
          ? route.preHandler
          : route.preHandler
            ? [route.preHandler]
            : []
      );
      for (const method of methods) {
        if (method === 'HEAD' || method === 'OPTIONS') continue;
        routes.push({
          method,
          url,
          schema: /** @type {Record<string, any>} */ (route.schema ?? {}),
          scope: handlers.find((h) => typeof h.scope === 'string')?.scope ?? null,
          idempotent: handlers.some((h) => h.idempotent === true),
        });
      }
    },
  };
}

/**
 * @typedef {object} Operation
 * @property {string} summary
 * @property {string} description
 * @property {string} tag
 * @property {Record<number, string>} [responses]   success and route-specific codes
 * @property {boolean} [form]   also accepts application/x-www-form-urlencoded
 */

/** Prose per route, keyed `METHOD /path`. @type {Record<string, Operation>} */
export const OPERATIONS = {
  'POST /api/contact': {
    tag: 'Forms',
    summary: 'Submit the contact form',
    description:
      'Stores a lead and queues a `lead.created` event for delivery. JSON or form-encoded. `form_id` (a UUID the page generates) deduplicates double submits; without it, the same email and message within 10 minutes count once. The `website` field is a honeypot: fill it and nothing is stored, but the response is identical.',
    responses: {
      202: 'Accepted and stored; notification happens asynchronously.',
      303: 'Form-encoded posts are redirected back to the page with `?sent=1` or `?error=<code>`.',
    },
    form: true,
  },
  'POST /api/subscribe': {
    tag: 'Forms',
    summary: 'Subscribe an email address',
    description:
      'Stores a subscriber for `newsletter` or `magnet:<slug>` and queues `subscriber.created`. Same dedupe and honeypot rules as the contact form. The site never sends email; your automation owns confirmation and delivery.',
    responses: {
      202: 'Accepted and stored.',
      303: 'Form-encoded posts are redirected back to the page.',
    },
    form: true,
  },
  'GET /api/v1/health': {
    tag: 'Operations',
    summary: 'Health check',
    description: 'Returns `{ "ok": true }`. No auth. Used by the platform healthcheck.',
    responses: { 200: '`{ ok: true }`' },
  },
  'GET /api/v1/status': {
    tag: 'Operations',
    summary: 'Delivery and backup status',
    description:
      'Outbox counts (pending, dead, delivered), the last successful delivery time, and whether backups are configured. No personal data.',
    responses: { 200: 'Status object.' },
  },
  'GET /api/v1/openapi.json': {
    tag: 'Operations',
    summary: 'This document',
    description:
      'The OpenAPI 3.1 description of every endpoint, generated from the running routes. No auth.',
    responses: { 200: 'OpenAPI document.' },
  },
  'GET /api/v1/leads': {
    tag: 'Leads',
    summary: 'List leads',
    description:
      'Oldest first, keyset-paginated. Follow `next_cursor` until it is `null`. Use this to catch up after a webhook outage.',
    responses: { 200: '`{ items: Lead[], next_cursor: string | null }`' },
  },
  'GET /api/v1/leads/:id': {
    tag: 'Leads',
    summary: 'Get a lead',
    description: 'One lead. The `ETag` header carries its `version` for use with `If-Match`.',
    responses: { 200: 'Lead.', 404: 'No such lead.' },
  },
  'PATCH /api/v1/leads/:id': {
    tag: 'Leads',
    summary: 'Update a lead',
    description:
      'Change `status` (`new`, `contacted`, `qualified`, `won`, `lost`), `tags` or `notes`. Send `If-Match: "<version>"` to refuse the write if someone else changed the lead first. Your own updates never come back to you as `lead.updated` events.',
    responses: {
      200: 'Updated lead with the new `version`.',
      404: 'No such lead.',
      412: '`If-Match` did not match the current version.',
    },
  },
  'GET /api/v1/outbox': {
    tag: 'Operations',
    summary: 'List outbox events',
    description:
      'Events by delivery status, newest first; defaults to `dead` (given up after 48 hours or rejected by a 4xx). Payloads are not included.',
    responses: { 200: '`{ items: OutboxEvent[] }`' },
  },
  'POST /api/v1/outbox/:id/retry': {
    tag: 'Operations',
    summary: 'Re-queue a dead event',
    description: 'Puts a dead event back on the delivery schedule with a fresh 48-hour window.',
    responses: { 200: '`{ ok: true, id }`', 404: 'No such event, or it is not dead.' },
  },
  'GET /api/v1/posts': {
    tag: 'Posts',
    summary: 'List posts',
    description:
      'Most recently updated first, keyset-paginated. Filter with `status` (`draft`, `published`, `unpublished`). Deleted posts are never listed.',
    responses: { 200: '`{ items: Post[], next_cursor: string | null }`' },
  },
  'GET /api/v1/posts/:id': {
    tag: 'Posts',
    summary: 'Get a post',
    description:
      'The head (latest) version plus status and pointers. `live_differs` is true when the published page is an older version than the head. `ETag` is the head version.',
    responses: { 200: 'Post.', 404: 'No such post, or it was deleted.' },
  },
  'POST /api/v1/posts': {
    tag: 'Posts',
    summary: 'Create a draft',
    description:
      'Creates version 1 of a new post as a draft. Nothing is public. The response includes `preview_url`: an unlisted, non-indexed page showing exactly how the post will render. Markdown only; HTML in the body is shown as text.',
    responses: {
      201: 'The new draft, with `id`, `head_version: 1` and `preview_url`.',
      409: "The slug is already taken (body has the other post's `id`).",
    },
  },
  'PATCH /api/v1/posts/:id': {
    tag: 'Posts',
    summary: 'Edit a post',
    description:
      'Creates a new head version with the given fields. A published post keeps serving its live version until you publish again. Send `If-Match: "<head_version>"` to avoid overwriting a concurrent edit. The slug cannot change once the post has ever been published.',
    responses: {
      200: 'The post with the new `head_version`.',
      404: 'No such post.',
      412: '`If-Match` did not match the head version.',
      422: 'Validation failed, or `slug_immutable`.',
    },
  },
  'POST /api/v1/posts/:id/publish': {
    tag: 'Posts',
    summary: 'Publish the head version',
    description:
      'Makes the head version live. The page is rendered within about a second and `post.published` is sent. Requires `content:publish`: the human step.',
    responses: { 200: 'The post, now `published`.', 404: 'No such post.' },
  },
  'POST /api/v1/posts/:id/unpublish': {
    tag: 'Posts',
    summary: 'Take a post off the site',
    description:
      'The page is removed; the post and all its versions are kept and can be published again. Sends `post.unpublished`.',
    responses: {
      200: 'The post, now `unpublished`.',
      404: 'No such post.',
      409: 'The post is not published.',
    },
  },
  'DELETE /api/v1/posts/:id': {
    tag: 'Posts',
    summary: 'Delete a post',
    description:
      'Soft delete: the page is removed and, if the post was ever published, its URL redirects (301) to the blog index. Versions and the audit trail are kept; the slug stays reserved.',
    responses: { 200: '`{ ok: true, id, redirect: "/blog" }`', 404: 'No such post.' },
  },
  'GET /api/v1/posts/:id/versions': {
    tag: 'Posts',
    summary: 'List versions',
    description:
      'Every version of the post, newest first, without bodies. Use `GET /posts/:id` for the head body or `revert` to bring an old one back.',
    responses: { 200: '`{ head_version, live_version, items: Version[] }`', 404: 'No such post.' },
  },
  'POST /api/v1/posts/:id/revert/:version': {
    tag: 'Posts',
    summary: 'Revert to a version',
    description:
      'Copies the given version into a new head version. If the post is published, the reverted content goes live at once.',
    responses: { 200: 'The post with the new head.', 404: 'No such post or version.' },
  },
  'GET /preview/:token': {
    tag: 'Posts',
    summary: 'Preview a draft',
    description:
      "The HTML page for a post's head version, at the `preview_url` returned by the API. No auth: the token is the secret. Sent with `noindex`, `no-store` and `Referrer-Policy: no-referrer`.",
    responses: { 200: 'HTML page.', 404: 'Unknown token or deleted post.' },
  },
};

/** Responses every keyed endpoint can return. */
const COMMON = {
  400: 'Malformed JSON, bad content type, or a missing `Idempotency-Key` where one is required.',
  401: 'Missing or unknown API key.',
  403: 'The key lacks the required scope.',
  413: 'Body over 16 KB.',
  422: 'Validation failed; the body names the field. Also: `Idempotency-Key` reused with a different body.',
  429: 'Rate limited; honour `Retry-After`.',
  503: 'Database busy; retry.',
};

/** Outbound events, documented as OpenAPI webhooks. */
export const WEBHOOK_EVENTS = {
  'lead.created': 'A contact-form submission was stored. `data` is the lead.',
  'subscriber.created': 'A subscription was stored. `data` has `id`, `email`, `list`, `source`.',
  'lead.updated':
    'A person edited a lead in the platform. Never sent for changes made through this API.',
  'post.published': 'A post went live. `data` has `id`, `slug`, `version`, `url`.',
  'post.unpublished': 'A post was taken down or deleted (`deleted: true`). Same `data` shape.',
  'site.updated': 'Site copy changed. `data` has `version`.',
};

/**
 * @param {CollectedRoute[]} routes
 * @param {{ siteUrl: string, siteName: string, version: string }} info
 */
export function buildOpenApi(routes, { siteUrl, siteName, version }) {
  /** @type {Record<string, Record<string, unknown>>} */
  const paths = {};
  for (const route of [...routes].sort(byPath)) {
    const key = `${route.method} ${route.url}`;
    const op = OPERATIONS[key];
    if (!op) continue; // the test catches this; the doc stays valid
    const path = route.url.replace(/:([a-zA-Z_]+)/g, '{$1}');
    paths[path] ??= {};
    paths[path][route.method.toLowerCase()] = operation(route, op);
  }

  return {
    openapi: '3.1.0',
    info: {
      title: `${siteName} API`,
      version,
      description:
        'Leads, subscribers and content for the site. Content written here is validated, versioned and reversible; publishing is a separate step that a person keeps.',
    },
    servers: [{ url: siteUrl }],
    tags: [
      { name: 'Posts', description: 'Drafts, previews, publishing, versions.' },
      { name: 'Leads', description: 'Contact-form submissions, for your CRM automation.' },
      { name: 'Forms', description: 'What the public pages post to. Rate limited per IP.' },
      { name: 'Operations', description: 'Health, delivery status, dead letters.' },
    ],
    components: {
      securitySchemes: {
        bearer: {
          type: 'http',
          scheme: 'bearer',
          description:
            'API key. Scopes are fixed per key: `leads:read`, `leads:write`, `content:read`, `content:write`, `content:publish`, `admin`. Each operation lists the one it needs under `x-scope`.',
        },
      },
      parameters: {
        IdempotencyKey: {
          name: 'Idempotency-Key',
          in: 'header',
          required: true,
          schema: { type: 'string', maxLength: 255 },
          description:
            'Any unique string per logical operation. Retrying with the same key and body returns the original response (`Idempotent-Replayed: true`); a different body gets 422; an overlapping request gets 409 with `Retry-After`. Kept 24 hours.',
        },
        IfMatch: {
          name: 'If-Match',
          in: 'header',
          required: false,
          schema: { type: 'string' },
          description: 'The version you last read, e.g. `"3"`. Mismatch returns 412.',
        },
      },
    },
    paths,
    webhooks: Object.fromEntries(
      Object.entries(WEBHOOK_EVENTS).map(([name, description]) => [
        name,
        {
          post: {
            summary: name,
            description: `${description} Delivered at least once to your webhook URL; deduplicate on \`event_id\`.`,
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      event_id: { type: 'string', format: 'uuid' },
                      event_type: { type: 'string', const: name },
                      occurred_at: { type: 'string', format: 'date-time' },
                      data: { type: 'object' },
                    },
                  },
                },
              },
            },
            parameters: [
              header('X-Webhook-Token', 'Shared secret, for your Header Auth.'),
              header('X-Event-Id', 'Same as `event_id`.'),
              header('X-Event-Type', 'Same as `event_type`.'),
              header('X-Timestamp', 'Epoch milliseconds when this attempt was sent.'),
              header(
                'X-Signature',
                '`sha256=<hex>`: HMAC-SHA256 of `"<X-Timestamp>.<raw body>"` with the signing secret.',
              ),
            ],
            responses: {
              200: {
                description:
                  'Acknowledged. Anything else is retried: 30s, 2m, 10m, 30m, 2h, then every 6h for 48h. A 4xx other than 408/429 parks the event as dead.',
              },
            },
          },
        },
      ]),
    ),
  };
}

/** @param {CollectedRoute} route @param {Operation} op */
function operation(route, op) {
  /** @type {Record<string, unknown>[]} */
  const parameters = [
    ...schemaParams(route.schema.params, 'path'),
    ...schemaParams(route.schema.querystring, 'query'),
  ];
  if (route.idempotent) parameters.push({ $ref: '#/components/parameters/IdempotencyKey' });
  if (route.method === 'PATCH') parameters.push({ $ref: '#/components/parameters/IfMatch' });

  const responses = Object.fromEntries(
    Object.entries({
      ...(route.scope ? COMMON : pick(COMMON, [400, 413, 422, 429, 503])),
      ...(op.responses ?? {}),
    })
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([code, description]) => [code, { description }]),
  );

  return {
    tags: [op.tag],
    summary: op.summary,
    description: op.description,
    ...(route.scope ? { security: [{ bearer: [] }], 'x-scope': route.scope } : {}),
    ...(parameters.length ? { parameters } : {}),
    ...(route.schema.body
      ? {
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: route.schema.body },
              ...(op.form
                ? { 'application/x-www-form-urlencoded': { schema: route.schema.body } }
                : {}),
            },
          },
        }
      : {}),
    responses,
  };
}

/**
 * @param {Record<string, any> | undefined} schema
 * @param {'path' | 'query'} where
 */
function schemaParams(schema, where) {
  if (!schema?.properties) return [];
  const required = new Set(schema.required ?? []);
  return Object.entries(schema.properties).map(([name, def]) => ({
    name,
    in: where,
    required: where === 'path' || required.has(name),
    schema: def,
  }));
}

/** @param {string} name @param {string} description */
function header(name, description) {
  return { name, in: 'header', required: true, schema: { type: 'string' }, description };
}

/** @param {Record<number, string>} obj @param {number[]} keys */
function pick(obj, keys) {
  return Object.fromEntries(keys.map((k) => [k, obj[k]]));
}

/** @param {CollectedRoute} a @param {CollectedRoute} b */
function byPath(a, b) {
  return a.url.localeCompare(b.url) || a.method.localeCompare(b.method);
}
