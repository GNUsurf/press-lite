/**
 * GET /api/v1/openapi.json and GET /docs: the API reference, generated from
 * the routes Fastify registered (collected by the onRoute hook in server.js)
 * and the prose in src/lib/openapi.js. Both are public and built once, on
 * first request, after every route exists.
 */
import fs from 'node:fs';
import path from 'node:path';
import { buildOpenApi } from '../lib/openapi.js';
import { runtimeContext } from '../build/preview.js';
import { renderDocs } from '../templates/pages/docs.js';

/**
 * @typedef {object} DocsOptions
 * @property {import('../lib/openapi.js').CollectedRoute[]} routes
 * @property {string} distDir
 * @property {string} version   package version, shown in the document
 */

/** @type {import('fastify').FastifyPluginAsync<DocsOptions>} */
export async function docsRoutes(app, { routes, distDir, version }) {
  /** @type {ReturnType<typeof buildOpenApi> | null} */
  let cached = null;
  const openapi = () => {
    cached ??= buildOpenApi(routes, {
      siteUrl: app.env.siteUrl,
      siteName: siteName(app),
      version,
    });
    return cached;
  };

  app.get('/api/v1/openapi.json', async (_request, reply) => {
    return reply.header('cache-control', 'public, max-age=300').send(openapi());
  });

  app.get('/docs', async (_request, reply) => {
    const ctx = runtimeContext({ db: app.db, env: app.env, distDir });
    reply.header('cache-control', 'public, max-age=300').header('x-robots-tag', 'noindex');
    if (!ctx) {
      // No render yet (first boot in progress): the JSON still works.
      return reply.code(503).send({ error: 'docs_not_ready', openapi: '/api/v1/openapi.json' });
    }
    return reply.type('text/html; charset=utf-8').send(renderDocs(ctx, openapi()).toString());
  });
}

/** The client-facing name, from the site copy when it exists. @param {import('fastify').FastifyInstance} app */
function siteName(app) {
  const row = /** @type {{ data: string } | undefined} */ (
    app.db.prepare('SELECT data FROM site_copy WHERE id = 1').get()
  );
  return row ? /** @type {{ name: string }} */ (JSON.parse(row.data)).name : 'Site';
}

/** @param {string} root */
export function packageVersion(root) {
  try {
    return /** @type {{ version: string }} */ (
      JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
    ).version;
  } catch {
    return '0.0.0';
  }
}
