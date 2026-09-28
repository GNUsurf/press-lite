/**
 * /api/v1/posts: the content API. See "Content: your AI can't break this" in
 * CLAUDE.md. Shape is validated by JSON Schema (limits from
 * src/content/rules.js); state rules live in src/services/posts.js and
 * surface here as status codes.
 *
 * Review gating is on: only `content:publish` can publish. The
 * `review_required` switch arrives in M13.
 */
import { requireScope, idempotent } from './auth.js';
import { parseIfMatch } from './v1.js';
import {
  TITLE,
  DESCRIPTION,
  TAGS,
  BODY_MAX_BYTES,
  SLUG_PATTERN,
  SLUG_MAX,
  DATE_PATTERN,
} from '../content/rules.js';
import {
  POST_STATUSES,
  PostError,
  createPost,
  updatePost,
  publishPost,
  unpublishPost,
  deletePost,
  revertPost,
  getPost,
  listPosts,
  listVersions,
  publicPost,
} from '../services/posts.js';

const postProperties = {
  slug: { type: 'string', pattern: SLUG_PATTERN, maxLength: SLUG_MAX },
  title: { type: 'string', minLength: TITLE.min, maxLength: TITLE.max },
  description: { type: 'string', minLength: DESCRIPTION.min, maxLength: DESCRIPTION.max },
  body: { type: 'string', maxLength: BODY_MAX_BYTES },
  tags: {
    type: 'array',
    minItems: TAGS.min,
    maxItems: TAGS.max,
    uniqueItems: true,
    items: { type: 'string', minLength: 1, maxLength: TAGS.tagMax },
  },
  date: { type: 'string', pattern: DATE_PATTERN },
  cover_asset_id: { type: ['string', 'null'], maxLength: 64 },
};

const postBody = {
  type: 'object',
  additionalProperties: false,
  required: ['slug', 'title', 'description', 'body', 'tags'],
  properties: postProperties,
};

const postPatch = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: postProperties,
};

const idParam = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'integer', minimum: 1 } },
};

/** @type {Record<PostError['code'], number>} */
const STATUS_FOR = {
  not_found: 404,
  slug_conflict: 409,
  bad_state: 409,
  version_mismatch: 412,
  slug_immutable: 422,
  invalid: 422,
};

/** @type {import('fastify').FastifyPluginAsync} */
export async function contentRoutes(app) {
  const { db, clock } = app;
  const siteUrl = app.env.siteUrl;
  const previewUrl = (/** @type {string} */ path) => `${siteUrl}${path}`;
  const present = (/** @type {import('../services/posts.js').PostDetail} */ d) => {
    const p = publicPost(d);
    return { ...p, preview_url: previewUrl(p.preview_path), url: p.url && previewUrl(p.url) };
  };
  /** Content changed in a way the public site can see. */
  const rerender = () => app.renderer.schedule();

  // Service outcomes → status codes, in one place.
  app.setErrorHandler((err, request, reply) => {
    if (err instanceof PostError) {
      return reply
        .code(STATUS_FOR[err.code])
        .send({ error: err.code, message: err.message, ...err.detail });
    }
    throw err; // the app-level handler classifies everything else
  });

  app.get(
    '/posts',
    {
      preHandler: requireScope('content:read'),
      schema: {
        querystring: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: POST_STATUSES.filter((s) => s !== 'deleted') },
            cursor: { type: 'string', maxLength: 200 },
            limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
          },
        },
      },
    },
    async (request) => {
      const q = /** @type {{ status?: any, cursor?: string, limit: number }} */ (request.query);
      const page = listPosts(db, q);
      return {
        items: page.items.map((p) => ({
          ...p,
          preview_url: previewUrl(p.preview_path),
          url: p.url && previewUrl(p.url),
        })),
        next_cursor: page.next_cursor,
      };
    },
  );

  app.get(
    '/posts/:id',
    { preHandler: requireScope('content:read'), schema: { params: idParam } },
    async (request, reply) => {
      const { id } = /** @type {{ id: number }} */ (request.params);
      const d = getPost(db, id);
      if (!d || d.post.status === 'deleted') return reply.code(404).send({ error: 'not_found' });
      return reply.header('etag', `"${d.post.head_version}"`).send(present(d));
    },
  );

  app.post(
    '/posts',
    { preHandler: [requireScope('content:write'), idempotent], schema: { body: postBody } },
    async (request, reply) => {
      const body = /** @type {PostBody} */ (request.body);
      const input = /** @type {import('../services/posts.js').PostInput} */ (toInput(body));
      const d = createPost(db, input, keyName(request), { clock });
      return reply.code(201).header('etag', '"1"').send(present(d));
    },
  );

  app.patch(
    '/posts/:id',
    {
      preHandler: [requireScope('content:write'), idempotent],
      schema: { params: idParam, body: postPatch },
    },
    async (request, reply) => {
      const { id } = /** @type {{ id: number }} */ (request.params);
      const ifVersion = parseIfMatch(request.headers['if-match']);
      if (ifVersion === null) return reply.code(400).send({ error: 'bad_if_match' });
      const patch = toInput(/** @type {Partial<PostBody>} */ (request.body));
      const d = updatePost(db, id, patch, keyName(request), { clock, ifVersion });
      return reply.header('etag', `"${d.post.head_version}"`).send(present(d));
    },
  );

  app.post(
    '/posts/:id/publish',
    { preHandler: [requireScope('content:publish'), idempotent], schema: { params: idParam } },
    async (request) => {
      const { id } = /** @type {{ id: number }} */ (request.params);
      const d = publishPost(db, id, keyName(request), { clock, siteUrl });
      rerender();
      return present(d);
    },
  );

  app.post(
    '/posts/:id/unpublish',
    { preHandler: [requireScope('content:publish'), idempotent], schema: { params: idParam } },
    async (request) => {
      const { id } = /** @type {{ id: number }} */ (request.params);
      const d = unpublishPost(db, id, keyName(request), { clock, siteUrl });
      rerender();
      return present(d);
    },
  );

  app.delete(
    '/posts/:id',
    { preHandler: [requireScope('content:publish'), idempotent], schema: { params: idParam } },
    async (request, reply) => {
      const { id } = /** @type {{ id: number }} */ (request.params);
      deletePost(db, id, keyName(request), { clock, siteUrl });
      rerender();
      return reply.code(200).send({ ok: true, id, redirect: '/blog' });
    },
  );

  app.get(
    '/posts/:id/versions',
    { preHandler: requireScope('content:read'), schema: { params: idParam } },
    async (request, reply) => {
      const { id } = /** @type {{ id: number }} */ (request.params);
      const d = getPost(db, id);
      if (!d || d.post.status === 'deleted') return reply.code(404).send({ error: 'not_found' });
      return {
        head_version: d.post.head_version,
        live_version: d.post.live_version,
        items: listVersions(db, id).map((v) => ({ ...v, tags: JSON.parse(v.tags) })),
      };
    },
  );

  app.post(
    '/posts/:id/revert/:version',
    {
      preHandler: [requireScope('content:publish'), idempotent],
      schema: {
        params: {
          type: 'object',
          required: ['id', 'version'],
          properties: {
            id: { type: 'integer', minimum: 1 },
            version: { type: 'integer', minimum: 1 },
          },
        },
      },
    },
    async (request) => {
      const { id, version } = /** @type {{ id: number, version: number }} */ (request.params);
      const d = revertPost(db, id, version, keyName(request), { clock, siteUrl });
      if (d.post.status === 'published') rerender();
      return present(d);
    },
  );
}

/**
 * @typedef {{ slug: string, title: string, description: string, body: string, tags: string[],
 *   date?: string, cover_asset_id?: string | null }} PostBody
 */

/** API field names → service field names. @param {Partial<PostBody>} body */
function toInput(body) {
  const { cover_asset_id, ...rest } = body;
  return cover_asset_id === undefined ? rest : { ...rest, coverAssetId: cover_asset_id };
}

/** @param {import('fastify').FastifyRequest} request */
function keyName(request) {
  return /** @type {import('../lib/api-keys.js').ApiKey} */ (request.apiKey).name;
}
