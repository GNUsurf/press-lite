/**
 * Fastify app factory (exported for tests) and the process entrypoint.
 *
 * One process serves the static site from `dist/`, the JSON API under `/api`,
 * and runs the outbox worker. See CLAUDE.md for the contract.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import formbody from '@fastify/formbody';
import fastifyStatic from '@fastify/static';
import { loadEnv, EnvError } from './lib/env.js';
import { loggerOptions } from './lib/log.js';
import { systemClock } from './lib/time.js';
import { withQuery } from './lib/urls.js';
import { openDatabase, isDatabaseUnavailable } from './db/index.js';
import { publicRoutes } from './routes/public.js';
import { v1Routes } from './routes/v1.js';
import { contentRoutes } from './routes/content.js';
import { previewRoutes } from './routes/preview.js';
import { recordIdempotentResponse } from './routes/auth.js';
import { createOutboxWorker } from './worker/outbox.js';
import { DIST_DIR } from './build/site.js';
import { createRenderer, nullRenderer } from './build/renderer.js';
import { seedIfEmpty } from './content/seed.js';
import { assetsDir } from './services/assets.js';

export const BODY_LIMIT = 16 * 1024;
export { DIST_DIR };

/**
 * @param {object} options
 * @param {import('./lib/env.js').Env} options.env
 * @param {import('./db/index.js').Db} options.db
 * @param {string} [options.distDir]
 * @param {import('./lib/time.js').Clock} [options.clock]
 * @param {import('fastify').FastifyServerOptions['logger']} [options.logger]
 * @param {import('./build/renderer.js').Renderer} [options.renderer]  re-renders after content changes
 */
export async function buildApp({
  env,
  db,
  distDir = DIST_DIR,
  clock = systemClock,
  logger,
  renderer = nullRenderer(),
}) {
  const app = Fastify({
    logger: logger ?? loggerOptions(),
    bodyLimit: BODY_LIMIT,
    trustProxy: true, // Railway terminates TLS and proxies; needed for real client IPs
  });

  app.decorate('env', env);
  app.decorate('db', db);
  app.decorate('clock', clock);
  app.decorate('renderer', renderer);
  app.decorateRequest('isFormPost', false);
  app.decorateRequest('apiKey', null);
  app.decorateRequest('idempotency', null);

  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'"],
        'img-src': ["'self'", 'data:'],
        'media-src': ["'self'"],
        'font-src': ["'self'"],
        'connect-src': ["'self'"],
        'object-src': ["'none'"],
        'base-uri': ["'self'"],
        'form-action': ["'self'"],
        'frame-ancestors': ["'none'"],
        ...(env.production ? { 'upgrade-insecure-requests': [] } : {}),
      },
    },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  });
  await app.register(rateLimit, { global: false });
  await app.register(formbody, { bodyLimit: BODY_LIMIT });

  app.addHook('onRequest', async (request, reply) => {
    request.isFormPost = (request.headers['content-type'] ?? '').startsWith(
      'application/x-www-form-urlencoded',
    );
    // Deleted posts keep their URL alive: /blog/<old-slug> → /blog.
    if (request.method === 'GET' || request.method === 'HEAD') {
      const target = renderer.redirectFor(request.url.split('?')[0]);
      if (target) return reply.redirect(target, 301);
    }
  });

  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler(notFoundHandler(distDir));

  await app.register(publicRoutes, { prefix: '/api' });
  await app.register(
    async (v1) => {
      // Every v1 POST/PATCH records its response for Idempotency-Key replays.
      v1.addHook('onSend', recordIdempotentResponse);
      await v1.register(v1Routes);
      await v1.register(contentRoutes);
    },
    { prefix: '/api/v1' },
  );
  await app.register(previewRoutes, { distDir });

  // Uploaded/seeded images live on the data volume, not in dist/. Their names
  // are uuids and the bytes never change, so they cache forever.
  await app.register(fastifyStatic, {
    root: assetsDir(env.dataDir),
    prefix: '/images/',
    decorateReply: false,
    serveDotFiles: false,
    cacheControl: true,
    maxAge: '1y',
    immutable: true,
  });

  if (fs.existsSync(distDir)) {
    await app.register(fastifyStatic, {
      root: distDir,
      extensions: ['html'], // /services → services.html, so URLs have no suffix
      index: ['index.html'],
      serveDotFiles: false,
      setHeaders(reply, filePath) {
        // Built assets are content-hashed; everything else must revalidate.
        const immutable = /[/\\]assets[/\\].+\.[0-9a-f]{8,}\./.test(filePath);
        reply.header(
          'cache-control',
          immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
        );
      },
    });
  }

  return app;
}

/**
 * @param {import('fastify').FastifyError} err
 * @param {import('fastify').FastifyRequest} request
 * @param {import('fastify').FastifyReply} reply
 */
function errorHandler(err, request, reply) {
  const { formRedirect } = request.routeOptions.config;
  const { status, code } = classifyError(err);

  if (status >= 500) request.log.error({ err }, 'request failed');

  if (request.isFormPost && formRedirect) {
    // `#error` lets the page reveal its message with CSS :target, no script needed.
    return reply.redirect(withQuery(`${formRedirect}#error`, { error: code }), 303);
  }
  return reply.code(status).send({ error: code, message: status >= 500 ? undefined : err.message });
}

/**
 * @param {import('fastify').FastifyError & { validation?: unknown }} err
 * @returns {{ status: number, code: string }}
 */
function classifyError(err) {
  if (err.validation) return { status: 422, code: 'validation_failed' };
  if (err.code?.startsWith('FST_ERR_CTP_')) {
    return err.statusCode === 413
      ? { status: 413, code: 'body_too_large' }
      : { status: 400, code: 'bad_request' };
  }
  if (isDatabaseUnavailable(err)) return { status: 503, code: 'database_unavailable' };
  const status = err.statusCode ?? 500;
  if (status === 429) return { status, code: 'rate_limited' };
  if (status >= 400 && status < 500) return { status, code: err.code ?? 'bad_request' };
  return { status: 500, code: 'internal_error' };
}

/** @param {string} distDir */
function notFoundHandler(distDir) {
  const page = path.join(distDir, '404.html');
  /**
   * @param {import('fastify').FastifyRequest} request
   * @param {import('fastify').FastifyReply} reply
   */
  return (request, reply) => {
    if (request.url.startsWith('/api/') || !fs.existsSync(page)) {
      return reply.code(404).send({ error: 'not_found' });
    }
    return reply.code(404).type('text/html; charset=utf-8').send(fs.createReadStream(page));
  };
}

async function main() {
  let env;
  try {
    env = loadEnv();
  } catch (err) {
    if (err instanceof EnvError) {
      console.error(`FATAL: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }

  const db = openDatabase(env.dataDir);
  const seeded = seedIfEmpty(db, { dataDir: env.dataDir });

  // The DB is the source of truth; dist/ is derived from it at every boot.
  // (The image's file-based build only exists so CI can validate the pages.)
  // The renderer logs through the app, which doesn't exist yet: forward lazily.
  /** @type {import('fastify').FastifyInstance} */
  let app;
  const renderer = createRenderer({
    db,
    env,
    log: {
      info: (obj, msg) => app.log.info(obj, msg),
      error: (obj, msg) => app.log.error(obj, msg),
    },
  });
  app = await buildApp({ env, db, renderer });
  app.log.info(seeded, 'seed import');
  renderer.renderNow();

  const worker = createOutboxWorker({ db, env, log: app.log });
  app.addHook('onClose', async () => {
    renderer.stop();
    await worker.stop();
    db.close();
  });

  await app.listen({ port: env.port, host: '0.0.0.0' });
  worker.start();

  for (const signal of /** @type {const} */ (['SIGTERM', 'SIGINT'])) {
    process.once(signal, () => {
      app.log.info({ signal }, 'shutting down');
      app.close().then(
        () => process.exit(0),
        (err) => {
          app.log.error({ err }, 'shutdown failed');
          process.exit(1);
        },
      );
    });
  }
}

const isEntrypoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntrypoint) {
  main().catch((err) => {
    console.error('FATAL:', err);
    process.exit(1);
  });
}
