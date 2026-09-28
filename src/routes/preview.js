/**
 * GET /preview/:token — the unlisted, noindex preview of a post's head
 * version. No auth: the token is the secret (43 random base64url chars),
 * shared by whoever holds the draft. Never cached, never indexed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { renderPreview } from '../build/preview.js';

/** @type {import('fastify').FastifyPluginAsync<{ distDir: string }>} */
export async function previewRoutes(app, { distDir }) {
  app.get(
    '/preview/:token',
    {
      schema: {
        params: {
          type: 'object',
          required: ['token'],
          properties: { token: { type: 'string', pattern: '^[A-Za-z0-9_-]{20,64}$' } },
        },
      },
    },
    async (request, reply) => {
      const { token } = /** @type {{ token: string }} */ (request.params);
      const preview = renderPreview({ db: app.db, env: app.env, token, distDir });
      reply.header('x-robots-tag', 'noindex, nofollow').header('cache-control', 'no-store');
      if (!preview) return notFound(reply, distDir);
      return reply.type('text/html; charset=utf-8').send(preview.html);
    },
  );
}

/** The site's 404 page when it exists, else JSON. @param {import('fastify').FastifyReply} reply @param {string} distDir */
function notFound(reply, distDir) {
  const page = path.join(distDir, '404.html');
  if (!fs.existsSync(page)) return reply.code(404).send({ error: 'not_found' });
  return reply.code(404).type('text/html; charset=utf-8').send(fs.createReadStream(page));
}
