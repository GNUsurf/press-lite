/**
 * preHandlers for the v1 API: Bearer-key scopes and Idempotency-Key.
 * Each returned handler is tagged (`.scope`, `.idempotent`) so the OpenAPI
 * generator can read the requirement straight off the route.
 */
import { sha256 } from '../lib/crypto.js';
import { findApiKey } from '../lib/api-keys.js';
import { nowIso } from '../lib/time.js';
import { beginIdempotent, completeIdempotent } from '../services/idempotency.js';

/**
 * 401 for a missing or unknown key, 403 for a known key without the scope.
 * @param {import('../lib/api-keys.js').Scope} scope
 * @returns {import('fastify').preHandlerAsyncHookHandler & { scope: string }}
 */
export function requireScope(scope) {
  /** @type {import('fastify').preHandlerAsyncHookHandler} */
  const check = async (request, reply) => {
    const match = /^Bearer\s+(\S+)$/i.exec(request.headers.authorization ?? '');
    const key = match && findApiKey(request.server.env.apiKeys, match[1]);
    if (!key) return reply.code(401).send({ error: 'unauthorized' });
    if (!key.scopes.includes(scope)) return reply.code(403).send({ error: 'forbidden' });
    request.apiKey = key;
  };
  return Object.assign(check, { scope });
}

/**
 * Must run after requireScope(). Records the request before the handler
 * runs; the paired onSend hook (`recordIdempotentResponse`) stores the result.
 * @type {import('fastify').preHandlerAsyncHookHandler & { idempotent: true }}
 */
export const idempotent = Object.assign(
  /** @type {import('fastify').preHandlerAsyncHookHandler} */
  async (request, reply) => {
    const header = request.headers['idempotency-key'];
    const key = Array.isArray(header) ? header[0] : header;
    if (!key || key.length > 255) {
      return reply.code(400).send({ error: 'idempotency_key_required' });
    }
    const keyName = /** @type {import('../lib/api-keys.js').ApiKey} */ (request.apiKey).name;
    const requestHash = sha256(
      `${request.method} ${request.url}\n${JSON.stringify(request.body ?? null)}`,
    );

    const outcome = beginIdempotent(request.server.db, {
      keyName,
      key,
      requestHash,
      nowIso: nowIso(request.server.clock),
    });

    switch (outcome.kind) {
      case 'proceed':
        request.idempotency = { keyName, key };
        return;
      case 'in_progress':
        return reply.code(409).header('retry-after', '2').send({ error: 'in_progress' });
      case 'mismatch':
        return reply.code(422).send({ error: 'idempotency_key_reused' });
      case 'replay':
        return reply
          .code(outcome.status)
          .header('idempotent-replayed', 'true')
          .type('application/json; charset=utf-8')
          .send(outcome.body);
    }
  },
  { idempotent: /** @type {const} */ (true) },
);

/** @type {import('fastify').onSendAsyncHookHandler} */
export async function recordIdempotentResponse(request, reply, payload) {
  if (!request.idempotency) return payload;
  completeIdempotent(request.server.db, {
    ...request.idempotency,
    status: reply.statusCode,
    body: typeof payload === 'string' ? payload : '',
  });
  return payload;
}
