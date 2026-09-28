import type { Db } from '../src/db/index.js';
import type { Env } from '../src/lib/env.js';
import type { Clock } from '../src/lib/time.js';
import type { ApiKey } from '../src/lib/api-keys.js';
import type { Renderer } from '../src/build/renderer.js';

declare module 'fastify' {
  interface FastifyInstance {
    env: Env;
    db: Db;
    clock: Clock;
    /** Re-renders dist/ from the DB after content changes; owns the redirect map. */
    renderer: Renderer;
  }
  interface FastifyRequest {
    /** Content type was application/x-www-form-urlencoded: reply with redirects, not JSON. */
    isFormPost: boolean;
    /** Set by requireScope() after a successful Bearer check. */
    apiKey: ApiKey | null;
    /** Set by the idempotency preHandler when this request must record its response. */
    idempotency: { keyName: string; key: string } | null;
  }
  interface FastifyContextConfig {
    /** Browser-form routes: where to 303 on success or error. */
    formRedirect?: string;
  }
}
