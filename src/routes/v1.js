/**
 * /api/v1: what n8n calls. See "Inbound: n8n → site" in CLAUDE.md.
 */
import { nowIso } from '../lib/time.js';
import { requireScope, idempotent } from './auth.js';
import { getLead, listLeads, updateLead, publicLead, LEAD_STATUSES } from '../services/leads.js';
import { listOutbox, outboxStats, retryDead } from '../services/outbox.js';

const idParam = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'integer', minimum: 1 } },
};

const leadPatchBody = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    status: { type: 'string', enum: [...LEAD_STATUSES] },
    tags: {
      type: 'array',
      maxItems: 20,
      uniqueItems: true,
      items: { type: 'string', minLength: 1, maxLength: 50 },
    },
    notes: { type: 'string', maxLength: 10000 },
  },
};

/** @type {import('fastify').FastifyPluginAsync} */
export async function v1Routes(app) {
  app.get('/health', async () => ({ ok: true }));

  app.get('/status', { preHandler: requireScope('admin') }, async () => ({
    outbox: outboxStats(app.db),
    backups: {
      // Litestream runs as the parent process; the app can only report config.
      configured: Boolean(process.env.LITESTREAM_BUCKET),
    },
    now: nowIso(app.clock),
  }));

  app.get(
    '/leads',
    {
      preHandler: requireScope('leads:read'),
      schema: {
        querystring: {
          type: 'object',
          properties: {
            cursor: { type: 'string', maxLength: 200 },
            limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
          },
        },
      },
    },
    async (request) => {
      const { cursor, limit } = /** @type {{ cursor?: string, limit: number }} */ (request.query);
      return listLeads(app.db, { cursor, limit });
    },
  );

  app.get(
    '/leads/:id',
    { preHandler: requireScope('leads:read'), schema: { params: idParam } },
    async (request, reply) => {
      const { id } = /** @type {{ id: number }} */ (request.params);
      const lead = getLead(app.db, id);
      if (!lead) return reply.code(404).send({ error: 'not_found' });
      return reply.header('etag', `"${lead.version}"`).send(publicLead(lead));
    },
  );

  app.patch(
    '/leads/:id',
    {
      preHandler: [requireScope('leads:write'), idempotent],
      schema: { params: idParam, body: leadPatchBody },
    },
    async (request, reply) => {
      const { id } = /** @type {{ id: number }} */ (request.params);
      const patch = /** @type {import('../services/leads.js').LeadPatch} */ (request.body);
      const ifMatch = parseIfMatch(request.headers['if-match']);
      if (ifMatch === null) return reply.code(400).send({ error: 'bad_if_match' });

      // n8n's own edits never emit lead.updated (echo loop); see updateLead().
      const result = updateLead(app.db, id, patch, { ifVersion: ifMatch, clock: app.clock });
      if (!result.ok) {
        if (result.reason === 'not_found') return reply.code(404).send({ error: 'not_found' });
        return reply
          .code(412)
          .header('etag', `"${result.lead?.version}"`)
          .send({ error: 'version_mismatch', version: result.lead?.version });
      }
      return reply.header('etag', `"${result.lead.version}"`).send(publicLead(result.lead));
    },
  );

  app.get(
    '/outbox',
    {
      preHandler: requireScope('admin'),
      schema: {
        querystring: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['pending', 'delivered', 'dead'], default: 'dead' },
            limit: { type: 'integer', minimum: 1, maximum: 500, default: 100 },
          },
        },
      },
    },
    async (request) => {
      const { status, limit } =
        /** @type {{ status: 'pending' | 'delivered' | 'dead', limit: number }} */ (request.query);
      return { items: listOutbox(app.db, status, limit) };
    },
  );

  app.post(
    '/outbox/:id/retry',
    { preHandler: [requireScope('admin'), idempotent], schema: { params: idParam } },
    async (request, reply) => {
      const { id } = /** @type {{ id: number }} */ (request.params);
      if (!retryDead(app.db, id, nowIso(app.clock))) {
        return reply.code(404).send({ error: 'not_found' });
      }
      return { ok: true, id };
    },
  );
}

/**
 * `If-Match: "3"` or `If-Match: 3` → 3; absent → undefined; garbage → null.
 * @param {string | string[] | undefined} header
 */
export function parseIfMatch(header) {
  if (header === undefined) return undefined;
  const value = Array.isArray(header) ? header[0] : header;
  const match = /^\s*(?:W\/)?"?(\d+)"?\s*$/.exec(value);
  return match ? Number(match[1]) : null;
}
